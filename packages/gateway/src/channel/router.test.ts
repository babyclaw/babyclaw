import { describe, expect, it, vi } from "vitest";
import { ChannelRouter } from "./router.js";
import type { ChannelAdapter } from "./types.js";

function createMockAdapter(platform: string): ChannelAdapter {
  return {
    platform,
    capabilities: {
      supportsDraft: false,
      supportsMarkdown: true,
      supportsTypingIndicator: false,
      supportsEditing: false,
    },
    sendMessage: vi.fn(async () => ({ platformMessageId: "1" })),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
}

describe("ChannelRouter", () => {
  it("registers and retrieves an adapter by platform", () => {
    const router = new ChannelRouter();
    const adapter = createMockAdapter("telegram");
    router.register({ adapter });

    expect(router.getAdapter({ platform: "telegram" })).toBe(adapter);
  });

  it("throws when registering duplicate platform", () => {
    const router = new ChannelRouter();
    router.register({ adapter: createMockAdapter("telegram") });

    expect(() =>
      router.register({ adapter: createMockAdapter("telegram") }),
    ).toThrow("already registered");
  });

  it("throws when getting unregistered platform", () => {
    const router = new ChannelRouter();

    expect(() => router.getAdapter({ platform: "slack" })).toThrow(
      "No channel adapter registered",
    );
  });

  it("lists all registered platforms", () => {
    const router = new ChannelRouter();
    router.register({ adapter: createMockAdapter("telegram") });
    router.register({ adapter: createMockAdapter("discord") });

    const platforms = router.listPlatforms();
    expect(platforms).toContain("telegram");
    expect(platforms).toContain("discord");
    expect(platforms).toHaveLength(2);
  });

  it("hasAdapter returns correct boolean", () => {
    const router = new ChannelRouter();
    router.register({ adapter: createMockAdapter("telegram") });

    expect(router.hasAdapter({ platform: "telegram" })).toBe(true);
    expect(router.hasAdapter({ platform: "slack" })).toBe(false);
  });

  it("startAll calls start on all adapters", async () => {
    const router = new ChannelRouter();
    const telegram = createMockAdapter("telegram");
    const discord = createMockAdapter("discord");
    router.register({ adapter: telegram });
    router.register({ adapter: discord });

    const handler = vi.fn();
    await router.startAll({ onInboundEvent: handler });

    expect(telegram.start).toHaveBeenCalledWith({ onInboundEvent: handler });
    expect(discord.start).toHaveBeenCalledWith({ onInboundEvent: handler });
  });

  it("stopAll calls stop on all adapters", async () => {
    const router = new ChannelRouter();
    const telegram = createMockAdapter("telegram");
    const discord = createMockAdapter("discord");
    router.register({ adapter: telegram });
    router.register({ adapter: discord });

    await router.stopAll();

    expect(telegram.stop).toHaveBeenCalled();
    expect(discord.stop).toHaveBeenCalled();
  });
});
