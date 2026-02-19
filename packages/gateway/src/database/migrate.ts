import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export function applyMigrations({
  databaseUrl,
}: {
  databaseUrl: string;
}): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(__dirname, "..", "prisma", "schema.prisma");
  const prismaDir = dirname(require.resolve("prisma/package.json"));
  const prismaBin = resolve(prismaDir, "build", "index.js");

  execFileSync(
    process.execPath,
    [prismaBin, "migrate", "deploy", "--schema", schemaPath],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    },
  );
}
