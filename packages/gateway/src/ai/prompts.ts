import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Chat } from "../database/schema.js";
import type { ModelMessage } from "ai";
import type { CompletePersonalityFiles } from "../onboarding/personality.js";
import type { SkillEntry } from "../workspace/skills/types.js";

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

export async function readToolNotes({
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
  skills,
  toolNotesContent,
}: {
  skills: SkillEntry[];
  toolNotesContent?: string;
}): ModelMessage {
  return {
    role: "system",
    content: buildSkillsSystemPrompt({ skills, toolNotesContent }),
  };
}

function buildSkillsSystemPrompt({
  skills,
  toolNotesContent,
}: {
  skills: SkillEntry[];
  toolNotesContent?: string;
}): string {
  const lines = [
    "You have access to a skills system. Skills are SKILL.md files inside the skills/ directory of your workspace that teach you how to perform specific tasks.",
    "",
    "Using skills:",
    "1. When you receive a request, check the <available_skills> listing below to see if a relevant skill exists.",
    "2. If a skill matches, you MUST call workspace_read on the skill path to get the full instructions. Do NOT skip this step — the listing only contains a short description, not the actual instructions.",
    "3. Follow the instructions from the skill file you just read.",
    "4. If no skill matches, proceed normally with your built-in capabilities.",
  ];

  if (skills.length > 0) {
    lines.push("", "<available_skills>");
    for (const skill of skills) {
      const emoji = skill.frontmatter.openclaw?.emoji;
      const emojiAttr = emoji ? ` emoji="${emoji}"` : "";
      lines.push(
        `  <skill name="${escapeXmlAttr(skill.frontmatter.name)}"${emojiAttr}>`,
        `    <description>${escapeXmlText(skill.frontmatter.description)}</description>`,
        `    <path>${escapeXmlText(skill.relativePath)}</path>`,
        "  </skill>",
      );
    }
    lines.push("</available_skills>");
  } else {
    lines.push("", "No skills are currently available.");
  }

  if (toolNotesContent) {
    lines.push(
      "",
      "The following are environment-specific tool configuration notes from TOOLS.md. These contain details unique to the user's setup (device names, SSH hosts, preferences, etc.):",
      "",
      "<tool_notes>",
      toolNotesContent,
      "</tool_notes>",
    );
  }

  return lines.join("\n");
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    lines.push("<workspace_guide>", agentsContent, "</workspace_guide>");
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

export function getSelfManagementSystemMessage({
  configPath,
  adminSocketPath,
  logOutput,
}: {
  configPath: string;
  adminSocketPath: string;
  logOutput: string;
}): ModelMessage {
  const logLine =
    logOutput === "stdout"
      ? "Logs go to stdout and aren't accessible from here. To inspect logs, edit config to set logging.output to a file path, then restart."
      : `Tail recent logs: tail -n 100 ${logOutput}`;

  return {
    role: "system",
    content: [
      "You can manage your own runtime.",
      "Use self_status to check gateway state, uptime, and configuration paths.",
      "Use self_restart to gracefully restart (requires confirm: true). The process manager will bring you back.",
      `Your config is JSON at: ${configPath}`,
      `Read it: cat ${configPath} | jq .`,
      `Edit it: jq '<expression>' ${configPath} > /tmp/sc-cfg.json && mv /tmp/sc-cfg.json ${configPath}`,
      "After editing config, restart for changes to take effect.",
      `Check health: curl -s --unix-socket ${adminSocketPath} http://localhost/health`,
      logLine,
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
    lines.push("", "You are present in these linked chats:");
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

export function getHeartbeatSystemMessage({
  instructions,
}: {
  instructions: string;
}): ModelMessage {
  return {
    role: "system",
    content: [
      "You are performing a scheduled heartbeat check.",
      "Your workspace HEARTBEAT.md contains the following instructions:",
      "",
      "<heartbeat_instructions>",
      instructions,
      "</heartbeat_instructions>",
      "",
      "Follow these instructions using your available tools and your own judgment.",
      "Be thorough but concise. Use tools to check real state -- don't guess from old data.",
    ].join("\n"),
  };
}

export function buildHeartbeatVerdictMessages({
  phase1Response,
}: {
  phase1Response: string;
}): ModelMessage[] {
  return [
    {
      role: "user",
      content: [
        "You just completed a heartbeat check. Based on your findings below, report the result.",
        'Use "ok" if nothing needs the user\'s attention. Use "alert" if something should be delivered.',
        "",
        "<heartbeat_findings>",
        phase1Response,
        "</heartbeat_findings>",
      ].join("\n"),
    },
  ];
}

export function getWorkingMemorySystemMessage({
  workingMemory,
}: {
  workingMemory: string | null;
}): ModelMessage {
  const lines = [
    "<working_memory>",
    workingMemory ?? "(empty)",
    "</working_memory>",
    "",
    "Above is your working memory for this session. Use the update_working_memory tool to save important ephemeral information:",
    "tmux/screen session names, temporary file paths, URLs, port numbers, container IDs, branch names, intermediate results,",
    "or anything you need to remember to complete the current task efficiently.",
    "Update it proactively whenever you encounter such information. Overwrite the full content each time (it replaces, not appends).",
  ];
  return { role: "system", content: lines.join("\n") };
}

function buildSharedSystemPrompt({ personalityFiles }: SharedContextInput): string {
  const basePrompt = ["You are a personal assistant running inside OpenClaw."];

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
