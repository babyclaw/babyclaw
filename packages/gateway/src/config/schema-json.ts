import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { babyclawConfigSchema } from "./schema.js";

export function getBabyclawConfigJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(babyclawConfigSchema, {
    target: "draft-7",
  });

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "BabyClaw Runtime Configuration",
    ...jsonSchema,
  };
}

export async function writeBabyclawConfigJsonSchema({
  outputPath,
}: {
  outputPath: string;
}): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(getBabyclawConfigJsonSchema(), null, 2)}\n`,
    "utf8",
  );
}

async function runCli(): Promise<void> {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(thisDir, "../../../../");
  const outputPath = resolve(repoRoot, "docs", "babyclaw.schema.json");

  await writeBabyclawConfigJsonSchema({ outputPath });
  console.log(`Wrote config JSON schema to ${outputPath}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const thisFilePath = fileURLToPath(import.meta.url);

if (invokedPath === thisFilePath) {
  runCli().catch((error) => {
    console.error("Failed to generate config JSON schema:", error);
    process.exit(1);
  });
}
