import { z } from "zod";
import type { BabyclawConfig } from "../config/types.js";

export const heartbeatResultSchema = z.object({
  action: z
    .enum(["ok", "alert"])
    .describe("ok if nothing needs the user's attention. alert if something should be delivered."),
  message: z.string().nullable().describe("If alert, the concise message to deliver. Null if ok."),
  summary: z.string().describe("Brief internal summary of what was checked and found."),
});

export type HeartbeatConfig = BabyclawConfig["heartbeat"];
