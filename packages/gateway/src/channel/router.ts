import type { ChannelAdapter, InboundEventHandler } from "./types.js";

export class ChannelRouter {
  private readonly adapters = new Map<string, ChannelAdapter>();

  register({ adapter }: { adapter: ChannelAdapter }): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`Channel adapter already registered for platform: ${adapter.platform}`);
    }
    this.adapters.set(adapter.platform, adapter);
  }

  getAdapter({ platform }: { platform: string }): ChannelAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new Error(`No channel adapter registered for platform: ${platform}`);
    }
    return adapter;
  }

  listPlatforms(): string[] {
    return [...this.adapters.keys()];
  }

  hasAdapter({ platform }: { platform: string }): boolean {
    return this.adapters.has(platform);
  }

  async startAll({ onInboundEvent }: { onInboundEvent: InboundEventHandler }): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.start({ onInboundEvent });
    }
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
  }
}
