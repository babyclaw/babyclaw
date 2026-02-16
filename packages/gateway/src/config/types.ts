import type { z } from "zod";
import type { simpleclawConfigSchema } from "./schema.js";

export type SimpleclawConfig = z.infer<typeof simpleclawConfigSchema>;
