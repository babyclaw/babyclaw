import type { z } from "zod";
import type { babyclawConfigSchema } from "./schema.js";

export type BabyclawConfig = z.infer<typeof babyclawConfigSchema>;
