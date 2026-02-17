import { homedir } from "node:os";
import { join } from "node:path";

export function getAdminSocketPath(): string {
  return join(homedir(), ".simpleclaw", "gateway.sock");
}
