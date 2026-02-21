import { describe, expect, it } from "vitest";
import { applyJsonMergePatch, isStateDocument, normalizeStateKey } from "./state.js";

describe("normalizeStateKey", () => {
  it("returns a valid simple key unchanged", () => {
    expect(normalizeStateKey({ key: "my-key" })).toBe("my-key");
  });

  it("accepts keys with dots, slashes, and underscores", () => {
    expect(normalizeStateKey({ key: "config/app.settings" })).toBe("config/app.settings");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(normalizeStateKey({ key: "config\\app" })).toBe("config/app");
  });

  it("trims whitespace", () => {
    expect(normalizeStateKey({ key: "  my-key  " })).toBe("my-key");
  });

  it("throws on keys with invalid characters", () => {
    expect(() => normalizeStateKey({ key: "my key!" })).toThrow("Invalid state key");
  });

  it("throws on keys starting with non-alphanumeric", () => {
    expect(() => normalizeStateKey({ key: ".hidden" })).toThrow("Invalid state key");
  });

  it("throws on path traversal (..)", () => {
    expect(() => normalizeStateKey({ key: "foo/../bar" })).toThrow(
      "Invalid state key path segments",
    );
  });

  it("throws on leading slash", () => {
    expect(() => normalizeStateKey({ key: "/absolute" })).toThrow("Invalid state key");
  });

  it("throws on trailing slash", () => {
    expect(() => normalizeStateKey({ key: "dir/" })).toThrow("Invalid state key path segments");
  });

  it("throws on keys exceeding 256 characters", () => {
    const longKey = "a".repeat(258);
    expect(() => normalizeStateKey({ key: longKey })).toThrow("Invalid state key");
  });
});

describe("applyJsonMergePatch", () => {
  it("merges new properties into target", () => {
    const result = applyJsonMergePatch({
      target: { a: 1 },
      patch: { b: 2 },
    });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("overrides existing properties", () => {
    const result = applyJsonMergePatch({
      target: { a: 1 },
      patch: { a: 2 },
    });
    expect(result).toEqual({ a: 2 });
  });

  it("deletes properties when patch value is null", () => {
    const result = applyJsonMergePatch({
      target: { a: 1, b: 2 },
      patch: { a: null },
    });
    expect(result).toEqual({ b: 2 });
  });

  it("merges nested objects recursively", () => {
    const result = applyJsonMergePatch({
      target: { a: { b: 1, c: 2 } },
      patch: { a: { c: 3, d: 4 } },
    });
    expect(result).toEqual({ a: { b: 1, c: 3, d: 4 } });
  });

  it("deletes nested properties with null", () => {
    const result = applyJsonMergePatch({
      target: { a: { b: 1, c: 2 } },
      patch: { a: { b: null } },
    });
    expect(result).toEqual({ a: { c: 2 } });
  });

  it("replaces target entirely when patch is a non-object", () => {
    const result = applyJsonMergePatch({
      target: { a: 1 },
      patch: "hello",
    });
    expect(result).toBe("hello");
  });

  it("replaces non-object target with object patch", () => {
    const result = applyJsonMergePatch({
      target: "hello",
      patch: { a: 1 },
    });
    expect(result).toEqual({ a: 1 });
  });

  it("replaces arrays instead of merging them", () => {
    const result = applyJsonMergePatch({
      target: { items: [1, 2, 3] },
      patch: { items: [4, 5] },
    });
    expect(result).toEqual({ items: [4, 5] });
  });

  it("handles null target with object patch", () => {
    const result = applyJsonMergePatch({
      target: null,
      patch: { a: 1 },
    });
    expect(result).toEqual({ a: 1 });
  });

  it("handles empty patch (no-op)", () => {
    const result = applyJsonMergePatch({
      target: { a: 1, b: 2 },
      patch: {},
    });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe("isStateDocument", () => {
  it("returns true for a valid document", () => {
    expect(
      isStateDocument({
        key: "test",
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: { data: true },
      }),
    ).toBe(true);
  });

  it("returns true when value is null", () => {
    expect(
      isStateDocument({
        key: "test",
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: null,
      }),
    ).toBe(true);
  });

  it("returns false for null", () => {
    expect(isStateDocument(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isStateDocument("string")).toBe(false);
  });

  it("returns false when key is missing", () => {
    expect(
      isStateDocument({
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: {},
      }),
    ).toBe(false);
  });

  it("returns false when version is 0", () => {
    expect(
      isStateDocument({
        key: "test",
        version: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: {},
      }),
    ).toBe(false);
  });

  it("returns false when version is not finite", () => {
    expect(
      isStateDocument({
        key: "test",
        version: Infinity,
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: {},
      }),
    ).toBe(false);
  });

  it("returns false when value property is absent", () => {
    expect(
      isStateDocument({
        key: "test",
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});
