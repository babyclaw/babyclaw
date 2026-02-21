import type { ChatRegistry } from "../chat/registry.js";

export type ActorIdentity = {
  platform: string;
  platformUserId: string;
};

type IsOwnerInput = {
  actor: ActorIdentity;
  chatRegistry: ChatRegistry;
};

export async function isOwner({ actor, chatRegistry }: IsOwnerInput): Promise<boolean> {
  const mainChat = await chatRegistry.getMainChat();
  if (!mainChat) {
    return false;
  }

  return mainChat.platformChatId === actor.platformUserId;
}
