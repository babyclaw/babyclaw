import { describe, expect, it } from "vitest";
import type { Chat } from "../database/schema.js";
import {
  buildScheduleFollowupSystemNote,
  buildScheduledTaskUserContent,
  getBrowserToolsSystemMessage,
  getMainSessionSystemMessage,
  getNonMainSessionSystemMessage,
  getScheduledExecutionSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
} from "./prompts.js";

describe("getSharedSystemMessage", () => {
  it("returns a system message with base prompt when no personality", () => {
    const msg = getSharedSystemMessage({ workspacePath: "/tmp/ws" });
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("personal assistant");
  });

  it("does not include personality tags when personalityFiles is undefined", () => {
    const msg = getSharedSystemMessage({ workspacePath: "/tmp/ws" });
    expect(msg.content).not.toContain("<identity>");
    expect(msg.content).not.toContain("<soul>");
    expect(msg.content).not.toContain("<user>");
  });

  it("includes all personality files when provided", () => {
    const msg = getSharedSystemMessage({
      workspacePath: "/tmp/ws",
      personalityFiles: {
        identity: "I am a bot named Claw",
        soul: "Be helpful and concise",
        user: "User prefers short answers",
      },
    });
    expect(msg.content).toContain("<identity>");
    expect(msg.content).toContain("I am a bot named Claw");
    expect(msg.content).toContain("</identity>");
    expect(msg.content).toContain("<soul>");
    expect(msg.content).toContain("Be helpful and concise");
    expect(msg.content).toContain("</soul>");
    expect(msg.content).toContain("<user>");
    expect(msg.content).toContain("User prefers short answers");
    expect(msg.content).toContain("</user>");
  });

  it("still includes the base prompt when personality is provided", () => {
    const msg = getSharedSystemMessage({
      workspacePath: "/tmp/ws",
      personalityFiles: {
        identity: "id",
        soul: "soul",
        user: "user",
      },
    });
    expect(msg.content).toContain("personal assistant");
  });
});

describe("getSchedulerGuidanceSystemMessage", () => {
  it("returns a system message", () => {
    const msg = getSchedulerGuidanceSystemMessage();
    expect(msg.role).toBe("system");
  });

  it("includes scheduling guidance", () => {
    const msg = getSchedulerGuidanceSystemMessage();
    expect(msg.content).toContain("create_schedule");
    expect(msg.content).toContain("get_current_time");
    expect(msg.content).toContain("cron expression");
  });

  it("mentions fuzzy time defaults", () => {
    const msg = getSchedulerGuidanceSystemMessage();
    expect(msg.content).toContain("morning=09:00");
    expect(msg.content).toContain("afternoon=14:00");
    expect(msg.content).toContain("evening=19:00");
  });
});

describe("buildScheduleFollowupSystemNote", () => {
  it("includes the task prompt and ISO date", () => {
    const result = buildScheduleFollowupSystemNote({
      taskPrompt: "Check the weather",
      scheduledFor: new Date("2026-03-01T09:00:00.000Z"),
    });
    expect(result).toContain("follow-up to a scheduled run");
    expect(result).toContain("2026-03-01T09:00:00.000Z");
    expect(result).toContain("Check the weather");
  });
});

describe("getScheduledExecutionSystemMessage", () => {
  it("returns a system message about automated execution", () => {
    const msg = getScheduledExecutionSystemMessage();
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("triggered automatically by the scheduler");
    expect(msg.content).toContain("Do not ask clarifying questions");
  });
});

describe("buildScheduledTaskUserContent", () => {
  it("includes the SCHEDULED EXECUTION marker", () => {
    const result = buildScheduledTaskUserContent({
      taskPrompt: "Send daily report",
      scheduledFor: new Date("2026-03-01T09:00:00.000Z"),
    });
    expect(result).toContain("[SCHEDULED EXECUTION]");
    expect(result).toContain("2026-03-01T09:00:00.000Z");
    expect(result).toContain("Send daily report");
  });
});

describe("getSkillsSystemMessage", () => {
  it("includes available skills when provided", () => {
    const msg = getSkillsSystemMessage({
      skills: [
        {
          frontmatter: {
            name: "weather",
            description: "Fetch weather forecasts",
            userInvocable: true,
            disableModelInvocation: false,
            openclaw: { emoji: "🌤️" },
          },
          slug: "weather",
          relativePath: "skills/weather/SKILL.md",
        },
      ],
    });
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("<available_skills>");
    expect(msg.content).toContain("weather");
    expect(msg.content).toContain("Fetch weather forecasts");
    expect(msg.content).toContain("skills/weather/SKILL.md");
    expect(msg.content).toContain("</available_skills>");
  });

  it("shows no skills message when array is empty", () => {
    const msg = getSkillsSystemMessage({ skills: [] });
    expect(msg.content).toContain("No skills are currently available");
    expect(msg.content).not.toContain("</available_skills>");
  });

  it("includes tool notes when provided", () => {
    const msg = getSkillsSystemMessage({
      skills: [],
      toolNotesContent: "### SSH\n- home-server: 192.168.1.100",
    });
    expect(msg.content).toContain("<tool_notes>");
    expect(msg.content).toContain("home-server");
    expect(msg.content).toContain("</tool_notes>");
  });

  it("always includes the skills usage instructions", () => {
    const msg = getSkillsSystemMessage({
      skills: [
        {
          frontmatter: {
            name: "test",
            description: "Does something",
            userInvocable: true,
            disableModelInvocation: false,
          },
          slug: "test",
          relativePath: "skills/test/SKILL.md",
        },
      ],
    });
    expect(msg.content).toContain("workspace_read");
    expect(msg.content).toContain("MUST");
  });
});

describe("getWorkspaceGuideSystemMessage", () => {
  it("includes AGENTS.md content when provided", () => {
    const msg = getWorkspaceGuideSystemMessage({
      agentsContent: "Follow these workspace rules.",
    });
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("<workspace_guide>");
    expect(msg.content).toContain("Follow these workspace rules.");
    expect(msg.content).toContain("</workspace_guide>");
  });

  it("includes bootstrap content when provided", () => {
    const msg = getWorkspaceGuideSystemMessage({
      bootstrapContent: "Set up your identity by writing IDENTITY.md",
    });
    expect(msg.content).toContain("<bootstrap_instructions>");
    expect(msg.content).toContain("Set up your identity");
    expect(msg.content).toContain("</bootstrap_instructions>");
  });

  it("includes both agents and bootstrap content", () => {
    const msg = getWorkspaceGuideSystemMessage({
      agentsContent: "Workspace rules",
      bootstrapContent: "Bootstrap steps",
    });
    expect(msg.content).toContain("<workspace_guide>");
    expect(msg.content).toContain("<bootstrap_instructions>");
  });

  it("returns empty content when neither is provided", () => {
    const msg = getWorkspaceGuideSystemMessage({});
    expect(msg.role).toBe("system");
    expect(msg.content).toBe("");
  });
});

describe("getBrowserToolsSystemMessage", () => {
  it("returns a system message about browser tools", () => {
    const msg = getBrowserToolsSystemMessage();
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("browser automation");
    expect(msg.content).toContain("browser_agent_task");
    expect(msg.content).toContain("browser_navigate");
  });

  it("mentions limitations", () => {
    const msg = getBrowserToolsSystemMessage();
    expect(msg.content).toContain("headless mode");
    expect(msg.content).toContain("File downloads are not supported");
  });
});

function makeChatRecord(overrides: Partial<Chat> = {}): Chat {
  return {
    id: "chat-1",
    platform: "telegram",
    platformChatId: "-1001234567890",
    type: "group",
    title: "Family Group",
    alias: "family",
    isMain: false,
    linkedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("getMainSessionSystemMessage", () => {
  it("includes MAIN SESSION marker", () => {
    const msg = getMainSessionSystemMessage({ linkedChats: [] });
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("MAIN SESSION");
  });

  it("lists linked chats with alias, title, type, and platform", () => {
    const chats = [
      makeChatRecord({ isMain: true, title: "Owner DM", alias: null }),
      makeChatRecord({ alias: "family", title: "Family Group", type: "group", platformChatId: "-1001234" }),
      makeChatRecord({ alias: "work", title: "Work Team", type: "supergroup", platformChatId: "-1009876" }),
    ];
    const msg = getMainSessionSystemMessage({ linkedChats: chats });
    expect(msg.content).toContain('"Family Group" (group, alias: family');
    expect(msg.content).toContain('"Work Team" (supergroup, alias: work');
    expect(msg.content).toContain("send_message");
  });

  it("handles empty linked chats list", () => {
    const msg = getMainSessionSystemMessage({ linkedChats: [] });
    expect(msg.content).toContain("MAIN SESSION");
    expect(msg.content).not.toContain("linked chats:");
  });

  it("excludes main chat from the list", () => {
    const chats = [
      makeChatRecord({ isMain: true, title: "Owner DM", alias: null }),
    ];
    const msg = getMainSessionSystemMessage({ linkedChats: chats });
    expect(msg.content).not.toContain("Owner DM");
  });
});

describe("getNonMainSessionSystemMessage", () => {
  it("includes chat title and alias", () => {
    const msg = getNonMainSessionSystemMessage({
      chatTitle: "Family Group",
      alias: "family",
    });
    expect(msg.role).toBe("system");
    expect(msg.content).toContain('"Family Group"');
    expect(msg.content).toContain("alias: family");
    expect(msg.content).toContain("not the main session");
  });

  it("works without an alias", () => {
    const msg = getNonMainSessionSystemMessage({
      chatTitle: "Random Group",
    });
    expect(msg.content).toContain('"Random Group"');
    expect(msg.content).not.toContain("alias:");
  });

  it("instructs not to load MEMORY.md", () => {
    const msg = getNonMainSessionSystemMessage({
      chatTitle: "Test",
    });
    expect(msg.content).toContain("Do not load MEMORY.md");
  });
});
