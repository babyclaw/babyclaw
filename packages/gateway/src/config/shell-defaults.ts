export const SHELL_MODES = ["allowlist", "full-access"] as const;

export type ShellMode = (typeof SHELL_MODES)[number];

export type ShellConfig = {
  mode: ShellMode;
  allowedCommands: string[];
};

export const DEFAULT_SHELL_MODE: ShellMode = "allowlist";

export const DEFAULT_SHELL_ALLOWED_COMMANDS: string[] = [
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "file",
  "du",
  "df",
  "date",
  "echo",
  "env",
  "pwd",
  "sort",
  "uniq",
  "cut",
  "awk",
  "sed",
  "tr",
  "xargs",
  "tee",
  "diff",
  "which",
  "basename",
  "dirname",
  "realpath",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "touch",
  "chmod",
  "git",
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "python",
  "python3",
  "pip",
  "pip3",
  "curl",
  "wget",
  "jq",
  "tar",
  "zip",
  "unzip",
  "remindctl",
];
