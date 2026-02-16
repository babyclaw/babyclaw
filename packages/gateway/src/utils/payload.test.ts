import { describe, expect, it } from "vitest";
import {
  MAX_TOOL_PAYLOAD_BYTES,
  ensureJsonWithinLimit,
  ensurePayloadWithinLimit,
} from "./payload.js";

describe("ensurePayloadWithinLimit", () => {
  it("does not throw when value is under the limit", () => {
    expect(() =>
      ensurePayloadWithinLimit({ value: "hello" }),
    ).not.toThrow();
  });

  it("does not throw when value is exactly at the limit", () => {
    const value = "x".repeat(MAX_TOOL_PAYLOAD_BYTES);
    expect(() => ensurePayloadWithinLimit({ value })).not.toThrow();
  });

  it("throws when value exceeds the default limit", () => {
    const value = "x".repeat(MAX_TOOL_PAYLOAD_BYTES + 1);
    expect(() => ensurePayloadWithinLimit({ value })).toThrow(
      `Payload exceeds ${MAX_TOOL_PAYLOAD_BYTES} bytes`,
    );
  });

  it("respects a custom maxBytes", () => {
    expect(() =>
      ensurePayloadWithinLimit({ value: "abc", maxBytes: 2 }),
    ).toThrow("Payload exceeds 2 bytes");
  });

  it("measures multi-byte characters correctly", () => {
    // "€" is 3 bytes in UTF-8
    expect(() =>
      ensurePayloadWithinLimit({ value: "€", maxBytes: 2 }),
    ).toThrow();

    expect(() =>
      ensurePayloadWithinLimit({ value: "€", maxBytes: 3 }),
    ).not.toThrow();
  });
});

describe("ensureJsonWithinLimit", () => {
  it("does not throw for small objects", () => {
    expect(() =>
      ensureJsonWithinLimit({ value: { key: "val" } }),
    ).not.toThrow();
  });

  it("throws when the serialized JSON exceeds the limit", () => {
    const bigArray = new Array(100).fill("x".repeat(1000));
    expect(() =>
      ensureJsonWithinLimit({ value: bigArray, maxBytes: 50 }),
    ).toThrow("Payload exceeds 50 bytes");
  });
});
