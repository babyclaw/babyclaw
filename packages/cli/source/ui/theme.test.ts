import { describe, it, expect } from "vitest";
import { formatUptime, getRandomBanner, getRandomTip } from "./theme.js";

describe("formatUptime", () => {
  it("formats seconds", () => {
    expect(formatUptime(5000)).toBe("5s");
    expect(formatUptime(59000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatUptime(90_000)).toBe("1m 30s");
    expect(formatUptime(3_540_000)).toBe("59m 0s");
  });

  it("formats hours and minutes", () => {
    expect(formatUptime(3_600_000)).toBe("1h 0m");
    expect(formatUptime(7_260_000)).toBe("2h 1m");
  });

  it("formats days and hours", () => {
    expect(formatUptime(86_400_000)).toBe("1d 0h");
    expect(formatUptime(100_000_000)).toBe("1d 3h");
  });
});

describe("getRandomBanner", () => {
  it("returns a non-empty string", () => {
    const banner = getRandomBanner();
    expect(banner.length).toBeGreaterThan(0);
    expect(banner).toContain("simpleclaw");
  });
});

describe("getRandomTip", () => {
  it("returns a non-empty string", () => {
    const tip = getRandomTip();
    expect(tip.length).toBeGreaterThan(0);
  });
});
