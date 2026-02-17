import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Chat } from "@prisma/client";
import type { ModelMessage } from "ai";
import type { CompletePersonalityFiles } from "../onboarding/personality.js";

type SharedContextInput = {
  workspacePath: string;
  personalityFiles?: CompletePersonalityFiles;
};

export function getSharedSystemMessage({
  workspacePath,
  personalityFiles,
}: SharedContextInput): ModelMessage {
  return {
    role: "system",
    content: buildSharedSystemPrompt({ workspacePath, personalityFiles }),
  };
}

export function getSchedulerGuidanceSystemMessage(): ModelMessage {
  return {
    role: "system",
    content: [
      "You can manage schedules via tools in this chat.",
      "Use create_schedule only when user intent is clearly scheduling.",
      "For relative schedule requests (for example: in 30 minutes, tomorrow morning, next Monday), call get_current_time first, then compute schedule fields.",
      "For absolute timestamp requests, calling get_current_time is optional.",
      "For recurring schedules, provide a cron expression.",
      "Timezone is fixed by the bot and cannot be changed by tools.",
      "Fuzzy defaults for scheduling: morning=09:00, afternoon=14:00, evening=19:00.",
      "You also have generic tools for workspace files and managed state keys.",
      "For destructive file actions (delete/overwrite/move-overwrite), require explicit user intent.",
      "After create or cancel, confirm schedule id and next run in your reply.",
      "If cancel_schedule returns ambiguous, ask user to choose one candidate id.",
      "You can run shell commands via the shell_exec tool for tasks like checking git status, running scripts, fetching URLs, etc.",
    ].join("\n"),
  };
}

export function buildScheduleFollowupSystemNote({
  taskPrompt,
  scheduledFor,
}: {
  taskPrompt: string;
  scheduledFor: Date;
}): string {
  return [
    "This chat is a follow-up to a scheduled run.",
    `scheduled_for_iso: ${scheduledFor.toISOString()}`,
    "original_task:",
    taskPrompt,
  ].join("\n");
}

export function getScheduledExecutionSystemMessage(): ModelMessage {
  return {
    role: "system",
    content: [
      "This run was triggered automatically by the scheduler, not by a live user message.",
      "Execute the scheduled task directly and provide the result now.",
      "Do not ask clarifying questions, offer options, or explain scheduling limitations.",
      "If the task is a reminder, deliver the reminder message clearly.",
      "If tool calls are needed to complete the task, use them and then return the final result.",
    ].join("\n"),
  };
}

export function buildScheduledTaskUserContent({
  taskPrompt,
  scheduledFor,
}: {
  taskPrompt: string;
  scheduledFor: Date;
}): string {
  return [
    "[SCHEDULED EXECUTION] The following task has been triggered by the scheduler.",
    `scheduled_for_iso: ${scheduledFor.toISOString()}`,
    "task:",
    taskPrompt,
  ].join("\n");
}

export async function readToolsIndex({
  workspacePath,
}: {
  workspacePath: string;
}): Promise<string | undefined> {
  try {
    const content = await readFile(join(workspacePath, "TOOLS.md"), "utf8");
    return content.trim().length > 0 ? content.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getSkillsSystemMessage({
  toolsIndexContent,
}: {
  toolsIndexContent?: string;
}): ModelMessage {
  return {
    role: "system",
    content: buildSkillsSystemPrompt({ toolsIndexContent }),
  };
}

function buildSkillsSystemPrompt({
  toolsIndexContent,
}: {
  toolsIndexContent?: string;
}): string {
  const lines = [
    "You have access to a skills system. Skills are markdown files in the skills/ directory of your workspace that teach you how to perform specific tasks.",
    "",
    "IMPORTANT: TOOLS.md is ONLY an index for matching — it contains short summaries, NOT the actual skill instructions. You MUST always read the full skill file before applying it. Never act on the summary alone.",
    "",
    "Using skills:",
    "1. When you receive a request, check the skills index below to see if a relevant skill exists.",
    "2. If a skill matches, you MUST call workspace_read on the skill file (e.g. path \"skills/<name>.md\") to get the full instructions. Do NOT skip this step.",
    "3. Follow the instructions from the skill file you just read — not the summary from TOOLS.md.",
    "4. If no skill matches, proceed normally with your built-in capabilities.",
    "",
    "Maintaining TOOLS.md:",
    "- TOOLS.md at the workspace root is your index of available skills. It is your responsibility to maintain this file.",
    "- If TOOLS.md does not exist yet, bootstrap it: use workspace_list on \"skills/\" to discover skill files, read each one, then write a TOOLS.md summarizing every skill with its filename and a short description of when to use it.",
    "- When you notice skills have been added, removed, or changed, update TOOLS.md accordingly.",
    "- Keep TOOLS.md concise: one line per skill with the filename and a brief description.",
  ];

  if (toolsIndexContent) {
    lines.push(
      "",
      "Current skills index:",
      "",
      "<tools_index>",
      toolsIndexContent,
      "</tools_index>",
    );
  } else {
    lines.push(
      "",
      "No TOOLS.md found. If skills/ exists and contains skill files, bootstrap TOOLS.md on your next opportunity.",
    );
  }

  return lines.join("\n");
}

export function getWorkspaceGuideSystemMessage({
  agentsContent,
  bootstrapContent,
}: {
  agentsContent?: string;
  bootstrapContent?: string;
}): ModelMessage {
  const lines: string[] = [];

  if (agentsContent) {
    lines.push(
      "<workspace_guide>",
      agentsContent,
      "</workspace_guide>",
    );
  }

  if (bootstrapContent) {
    lines.push(
      "",
      "<bootstrap_instructions>",
      "BOOTSTRAP.md exists in your workspace. This is your first run. Follow these instructions to set up your identity.",
      "",
      bootstrapContent,
      "</bootstrap_instructions>",
    );
  }

  return {
    role: "system",
    content: lines.join("\n"),
  };
}

export function getBrowserToolsSystemMessage(): ModelMessage {
  return {
    role: "system",
    content: [
      "You have access to browser automation tools powered by browser-use.",
      "",
      "Tool selection:",
      "- For complex multi-step web tasks (e.g. fill a form, search and compare results, navigate through multiple pages), prefer browser_agent_task which delegates to an autonomous browser agent.",
      "- For simple tasks (e.g. fetch content from a known URL), use the direct control tools: browser_navigate, browser_get_state, browser_click, browser_type, browser_scroll, browser_extract_content, browser_go_back.",
      "",
      "Direct control workflow:",
      "1. browser_navigate to the target URL.",
      "2. browser_get_state to see the page elements and their indices.",
      "3. Interact using browser_click, browser_type, or browser_scroll as needed.",
      "4. browser_extract_content to pull out the information you need.",
      "5. browser_go_back if you need to return to a previous page.",
      "",
      "Session management:",
      "- Browser sessions persist across tool calls within a conversation.",
      "- Use browser_list_sessions to see active sessions.",
      "- Use browser_close_session to clean up when you are done with a browser task.",
      "",
      "Limitations:",
      "- The browser runs in headless mode (no visible window).",
      "- File downloads are not supported.",
      "- Authentication state (cookies, sessions) does not persist across bot restarts.",
      "- Browser tasks can be slow; prefer direct API calls (curl via shell_exec) when you just need raw data from a public API.",
    ].join("\n"),
  };
}

export function getMainSessionSystemMessage({
  linkedChats,
}: {
  linkedChats: Chat[];
}): ModelMessage {
  const lines = [
    "You are in the MAIN SESSION -- your owner's direct chat.",
    "You can load MEMORY.md and other sensitive context here.",
  ];

  const nonMainChats = linkedChats.filter((c) => !c.isMain);
  if (nonMainChats.length > 0) {
    lines.push(
      "",
      "You are present in these linked chats:",
    );
    for (const chat of nonMainChats) {
      const aliasLabel = chat.alias ? `, alias: ${chat.alias}` : "";
      lines.push(
        `- "${chat.title ?? "Untitled"}" (${chat.type}${aliasLabel}, ${chat.platform}:${chat.platformChatId})`,
      );
    }
    lines.push(
      "",
      "Use the send_message tool with an alias to message any of these chats.",
      "Use the list_known_chats tool to refresh this list.",
    );
  }

  return {
    role: "system",
    content: lines.join("\n"),
  };
}

export function getNonMainSessionSystemMessage({
  chatTitle,
  alias,
}: {
  chatTitle: string;
  alias?: string;
}): ModelMessage {
  const aliasNote = alias ? ` (alias: ${alias})` : "";
  return {
    role: "system",
    content: [
      `You are in "${chatTitle}"${aliasNote}. This is not the main session.`,
      "Do not load MEMORY.md or share private context here.",
    ].join("\n"),
  };
}

function buildSharedSystemPrompt({
  workspacePath,
  personalityFiles,
}: SharedContextInput): string {
  const basePrompt = [
    "You are a personal assistant running inside OpenClaw.",
  ];

  if (!personalityFiles) {
    return basePrompt.join("\n");
  }

  return [
    ...basePrompt,
    "The following workspace personality files are canonical guidance.",
    "",
    "<identity>",
    personalityFiles.identity,
    "</identity>",
    "",
    "<soul>",
    personalityFiles.soul,
    "</soul>",
    "",
    "<user>",
    personalityFiles.user,
    "</user>",
  ].join("\n");
}
