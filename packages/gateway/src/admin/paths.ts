import { homedir } from "node:os";
import { join } from "node:path";

export function getAdminSocketPath(): string {
  return join(homedir(), ".babyclaw", "gateway.sock");
}
