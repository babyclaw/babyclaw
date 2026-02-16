import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { simpleclawConfigSchema } from "./schema.js";

export function getSimpleclawConfigJsonSchema(): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(simpleclawConfigSchema, {
    target: "draft-7",
  });

  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Simpleclaw Runtime Configuration",
    ...jsonSchema,
  };
}

export async function writeSimpleclawConfigJsonSchema({
  outputPath,
}: {
  outputPath: string;
}): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(getSimpleclawConfigJsonSchema(), null, 2)}\n`,
    "utf8",
  );
}

async function runCli(): Promise<void> {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(thisDir, "../../../../");
  const outputPath = resolve(repoRoot, "docs", "simpleclaw.schema.json");

  await writeSimpleclawConfigJsonSchema({ outputPath });
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
