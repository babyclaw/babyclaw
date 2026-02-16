import { describe, expect, it } from "vitest";
import { formatSchedulesForCommand } from "./formatter.js";

describe("formatSchedulesForCommand", () => {
  it("returns a message for empty schedules", () => {
    const result = formatSchedulesForCommand({ schedules: [] });
    expect(result).toBe("No active schedules in this chat.");
  });

  it("formats a single schedule", () => {
    const result = formatSchedulesForCommand({
      schedules: [
        {
          id: "abc-123",
          title: "Daily report",
          taskPrompt: "Generate report",
          status: "active",
          type: "recurring",
          nextRunAt: new Date("2026-03-01T09:00:00.000Z"),
        },
      ],
    });
    expect(result).toContain("1. **Daily report**");
    expect(result).toContain("id: abc-123");
    expect(result).toContain("type: recurring");
    expect(result).toContain("next: 2026-03-01T09:00:00.000Z");
  });

  it("falls back to taskPrompt when title is null", () => {
    const result = formatSchedulesForCommand({
      schedules: [
        {
          id: "x",
          title: null,
          taskPrompt: "Check the weather",
          status: "active",
          type: "one_off",
          nextRunAt: new Date("2026-04-01T12:00:00.000Z"),
        },
      ],
    });
    expect(result).toContain("1. **Check the weather**");
  });

  it("shows 'none' when nextRunAt is null", () => {
    const result = formatSchedulesForCommand({
      schedules: [
        {
          id: "y",
          title: "Paused job",
          taskPrompt: "do stuff",
          status: "active",
          type: "recurring",
          nextRunAt: null,
        },
      ],
    });
    expect(result).toContain("next: none");
  });

  it("formats multiple schedules separated by blank lines", () => {
    const result = formatSchedulesForCommand({
      schedules: [
        {
          id: "a",
          title: "First",
          taskPrompt: "t1",
          status: "active",
          type: "one_off",
          nextRunAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "b",
          title: "Second",
          taskPrompt: "t2",
          status: "active",
          type: "recurring",
          nextRunAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      ],
    });
    expect(result).toContain("1. **First**");
    expect(result).toContain("2. **Second**");
    // Two schedule blocks separated by a blank line
    expect(result.split("\n\n")).toHaveLength(2);
  });
});
