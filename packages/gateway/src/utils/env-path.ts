import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clearBinaryExistsCache } from "../workspace/skills/eligibility.js";

let cachedDirs: string[] | null = null;

function probeCommand({ cmd, args }: { cmd: string; args: string[] }): string | null {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function collectCandidates(): string[] {
  const home = homedir();
  const candidates: string[] = [];

  // uv (Python tool installer) — probe actual configured bin dir
  const uvBin = probeCommand({ cmd: "uv", args: ["tool", "dir", "--bin"] });
  if (uvBin) candidates.push(uvBin);

  // npm (Node global packages) — probe prefix and append /bin
  const npmPrefix = probeCommand({ cmd: "npm", args: ["config", "get", "prefix"] });
  if (npmPrefix) candidates.push(join(npmPrefix, "bin"));

  // Go — check env vars first, then default
  const goBin = process.env.GOBIN?.trim();
  if (goBin) candidates.push(goBin);
  const goPath = process.env.GOPATH?.trim();
  if (goPath) candidates.push(join(goPath, "bin"));

  // Static well-known directories
  candidates.push(
    join(home, ".local", "bin"), // uv, pip, pipx default
    join(home, ".cargo", "bin"), // Rust / cargo
    join(home, "go", "bin"), // Go default GOPATH
    "/opt/homebrew/bin", // Homebrew (macOS ARM)
    "/home/linuxbrew/.linuxbrew/bin", // Homebrew (Linux)
  );

  return candidates;
}

export function getToolBinDirs({ refresh }: { refresh?: boolean } = {}): string[] {
  if (cachedDirs && !refresh) return cachedDirs;

  const seen = new Set<string>();
  const dirs: string[] = [];

  for (const dir of collectCandidates()) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    if (existsSync(dir)) {
      dirs.push(dir);
    }
  }

  cachedDirs = dirs;
  return dirs;
}

export function buildAugmentedPath({ basePath }: { basePath: string }): string {
  const dirs = getToolBinDirs();
  if (dirs.length === 0) return basePath;

  const existing = new Set(basePath.split(":").filter(Boolean));
  const toAdd = dirs.filter((d) => !existing.has(d));

  if (toAdd.length === 0) return basePath;
  return [...toAdd, basePath].join(":");
}

export function augmentProcessPath(): void {
  const current = process.env.PATH ?? "";
  const augmented = buildAugmentedPath({ basePath: current });

  if (augmented !== current) {
    process.env.PATH = augmented;
    clearBinaryExistsCache();
  }
}

export function resetToolBinDirsCache(): void {
  cachedDirs = null;
}
