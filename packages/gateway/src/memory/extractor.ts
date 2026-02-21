import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AiAgent } from "../ai/agent.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";

type MemoryExtractorInput = {
  aiAgent: AiAgent;
  workspacePath: string;
};

const EXTRACTION_SYSTEM_PROMPT = [
  "You are a memory extraction system. You will be given a conversation transcript between a user and an AI assistant.",
  "Your job is to extract durable memories that are important to remember long-term.",
  "",
  "Focus on:",
  "- Decisions made or preferences expressed by the user",
  "- Project context, goals, and progress updates",
  "- Important events, milestones, or deadlines mentioned",
  "- Lessons learned or mistakes discussed",
  "- Relationship context (people mentioned, their roles, dynamics)",
  "- Technical choices, architecture decisions, or tool preferences",
  "- Personal details the user shared (interests, schedule patterns, etc.)",
  "",
  "Skip:",
  "- Transient small talk or greetings",
  "- Implementation details that are obvious from code (searchable later)",
  "- Information already present in the existing memories provided below",
  "- Routine tool usage or commands without meaningful context",
  "",
  "Output concise markdown bullet points only. Each bullet should be self-contained and understandable without the original conversation.",
  "",
  "IMPORTANT: Most conversations will NOT produce any new memories. That is completely normal and expected.",
  "Only extract something if it is genuinely worth remembering long-term. Do not force or fabricate memories.",
  "If there is nothing worth extracting, output exactly: NOTHING_TO_EXTRACT",
].join("\n");

export class MemoryExtractor {
  private readonly aiAgent: AiAgent;
  private readonly workspacePath: string;
  private readonly log: Logger;

  constructor({ aiAgent, workspacePath }: MemoryExtractorInput) {
    this.aiAgent = aiAgent;
    this.workspacePath = workspacePath;
    this.log = getLogger().child({ component: "memory-extractor" });
  }

  async extract({
    messages,
    sessionDate,
  }: {
    messages: Array<{ role: string; content: string }>;
    sessionDate: Date;
  }): Promise<void> {
    if (messages.length === 0) return;

    const transcript = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const label = m.role === "user" ? "User" : "Assistant";
        return `${label}: ${m.content}`;
      })
      .join("\n\n");

    if (transcript.trim().length === 0) return;

    const today = formatDate({ date: sessionDate });
    const memoryDir = join(this.workspacePath, "memory");
    const memoryFilePath = join(memoryDir, `${today}.md`);

    let existingMemory = "";
    try {
      existingMemory = await readFile(memoryFilePath, "utf8");
    } catch {
      // File doesn't exist yet
    }

    const userPromptParts = [];

    if (existingMemory.trim().length > 0) {
      userPromptParts.push(
        "<existing_memories_today>",
        existingMemory.trim(),
        "</existing_memories_today>",
        "",
      );
    }

    userPromptParts.push("<conversation_transcript>", transcript, "</conversation_transcript>");

    this.log.info(
      { messageCount: messages.length, date: today },
      "Extracting memories from conversation",
    );

    const result = await this.aiAgent.chat({
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: userPromptParts.join("\n") },
      ],
    });

    if (result.trim().length === 0 || result.trim() === "NOTHING_TO_EXTRACT") {
      this.log.info({ date: today }, "No new memories to extract");
      return;
    }

    await mkdir(memoryDir, { recursive: true });

    const separator = existingMemory.trim().length > 0 ? "\n\n" : "";
    const newContent =
      existingMemory.trim().length > 0
        ? existingMemory.trimEnd() + separator + result.trim() + "\n"
        : `# Memories - ${today}\n\n` + result.trim() + "\n";

    await writeFile(memoryFilePath, newContent, "utf8");

    this.log.info(
      { date: today, extractedLength: result.trim().length },
      "Memories extracted and written",
    );
  }
}

function formatDate({ date }: { date: Date }): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
