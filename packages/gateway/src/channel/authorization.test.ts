import { describe, expect, it, vi } from "vitest";
import { isOwner } from "./authorization.js";

function createMockChatRegistry(mainChat: any): any {
  return {
    getMainChat: vi.fn(async () => mainChat),
  };
}

describe("isOwner", () => {
  it("returns true when actor is the owner", async () => {
    const chatRegistry = createMockChatRegistry({
      id: "main-1",
      platformChatId: "12345",
      isMain: true,
    });

    const result = await isOwner({
      actor: { platform: "telegram", platformUserId: "12345" },
      chatRegistry,
    });

    expect(result).toBe(true);
  });

  it("returns false when actor is not the owner", async () => {
    const chatRegistry = createMockChatRegistry({
      id: "main-1",
      platformChatId: "12345",
      isMain: true,
    });

    const result = await isOwner({
      actor: { platform: "telegram", platformUserId: "99999" },
      chatRegistry,
    });

    expect(result).toBe(false);
  });

  it("returns false when no main chat exists", async () => {
    const chatRegistry = createMockChatRegistry(null);

    const result = await isOwner({
      actor: { platform: "telegram", platformUserId: "12345" },
      chatRegistry,
    });

    expect(result).toBe(false);
  });
});
