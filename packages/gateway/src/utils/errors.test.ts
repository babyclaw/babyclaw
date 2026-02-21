import { describe, expect, it } from "vitest";
import { toErrorMessage } from "./errors.js";

describe("toErrorMessage", () => {
  it("returns the message from an Error instance", () => {
    expect(toErrorMessage({ error: new Error("boom") })).toBe("boom");
  });

  it("returns the message from a subclass of Error", () => {
    expect(toErrorMessage({ error: new TypeError("bad type") })).toBe(
      "bad type",
    );
  });

  it("stringifies a plain string", () => {
    expect(toErrorMessage({ error: "something went wrong" })).toBe(
      "something went wrong",
    );
  });

  it("stringifies a number", () => {
    expect(toErrorMessage({ error: 42 })).toBe("42");
  });

  it("stringifies null", () => {
    expect(toErrorMessage({ error: null })).toBe("null");
  });

  it("stringifies undefined", () => {
    expect(toErrorMessage({ error: undefined })).toBe("undefined");
  });

  it("stringifies an object", () => {
    expect(toErrorMessage({ error: { code: 500 } })).toBe(
      "[object Object]",
    );
  });
});
