import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { getSkillInfo, getSkillVersionFiles, getSkillFileContent, ClawHubError } from "./client.js";

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function okText(body: string): Response {
  return new Response(body, { status: 200 });
}

function fail(status: number, body = ""): Response {
  return new Response(body, { status });
}

describe("ClawHubError", () => {
  it("exposes statusCode, slug, and message", () => {
    const err = new ClawHubError({
      statusCode: 418,
      slug: "teapot",
      message: "I'm a teapot",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(418);
    expect(err.slug).toBe("teapot");
    expect(err.message).toBe("I'm a teapot");
  });
});

describe("getSkillInfo", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls the correct URL and returns parsed JSON", async () => {
    const payload = { skill: { slug: "foo" } };
    mockFetch.mockResolvedValueOnce(ok(payload));

    const result = await getSkillInfo({ slug: "foo" });

    expect(mockFetch).toHaveBeenCalledWith("https://clawhub.ai/api/v1/skills/foo");
    expect(result).toEqual(payload);
  });

  it("encodes special characters in the slug", async () => {
    mockFetch.mockResolvedValueOnce(ok({ skill: {} }));
    await getSkillInfo({ slug: "a/b c" });

    expect(mockFetch).toHaveBeenCalledWith("https://clawhub.ai/api/v1/skills/a%2Fb%20c");
  });
});

describe("getSkillVersionFiles", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls the correct URL with slug and version", async () => {
    const payload = { version: { files: [] } };
    mockFetch.mockResolvedValueOnce(ok(payload));

    const result = await getSkillVersionFiles({
      slug: "my-skill",
      version: "1.0.0",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/skills/my-skill/versions/1.0.0",
    );
    expect(result).toEqual(payload);
  });

  it("encodes slug and version in the URL", async () => {
    mockFetch.mockResolvedValueOnce(ok({ version: {} }));
    await getSkillVersionFiles({ slug: "a/b", version: "1.0.0-beta+1" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/skills/a%2Fb/versions/1.0.0-beta%2B1",
    );
  });
});

describe("getSkillFileContent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls the correct URL with path query param", async () => {
    mockFetch.mockResolvedValueOnce(okText("# Skill content"));

    const result = await getSkillFileContent({
      slug: "my-skill",
      path: "SKILL.md",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/skills/my-skill/file?path=SKILL.md",
    );
    expect(result).toBe("# Skill content");
  });

  it("includes version query param when provided", async () => {
    mockFetch.mockResolvedValueOnce(okText("content"));

    await getSkillFileContent({
      slug: "my-skill",
      path: "SKILL.md",
      version: "2.0.0",
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/skills/my-skill/file?path=SKILL.md&version=2.0.0",
    );
  });

  it("omits version param when not provided", async () => {
    mockFetch.mockResolvedValueOnce(okText(""));
    await getSkillFileContent({ slug: "s", path: "f.md" });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain("version");
  });
});

describe("error handling", () => {
  beforeEach(() => vi.resetAllMocks());

  it("throws with 404 and a fixed message (ignores body)", async () => {
    mockFetch.mockResolvedValueOnce(fail(404, "custom body"));

    const err: ClawHubError = await getSkillInfo({ slug: "gone" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubError);
    expect(err.statusCode).toBe(404);
    expect(err.slug).toBe("gone");
    expect(err.message).toBe('Skill "gone" not found on ClawHub.');
  });

  it("throws with 403 using response body when present", async () => {
    mockFetch.mockResolvedValueOnce(fail(403, "Blocked by admin"));

    const err: ClawHubError = await getSkillInfo({ slug: "bad" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubError);
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe("Blocked by admin");
  });

  it("throws with 403 fallback when body is empty", async () => {
    mockFetch.mockResolvedValueOnce(fail(403));

    const err: ClawHubError = await getSkillInfo({ slug: "bad" }).catch((e) => e);
    expect(err.message).toBe('Skill "bad" is blocked by moderation.');
  });

  it("throws with 423 using response body when present", async () => {
    mockFetch.mockResolvedValueOnce(fail(423, "Scanning in progress"));

    const err: ClawHubError = await getSkillVersionFiles({
      slug: "pending",
      version: "1.0.0",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubError);
    expect(err.statusCode).toBe(423);
    expect(err.message).toBe("Scanning in progress");
  });

  it("throws with 423 fallback when body is empty", async () => {
    mockFetch.mockResolvedValueOnce(fail(423));

    const err: ClawHubError = await getSkillInfo({ slug: "pending" }).catch((e) => e);
    expect(err.message).toBe('Skill "pending" is pending a security scan. Try again shortly.');
  });

  it("throws with 410 using response body when present", async () => {
    mockFetch.mockResolvedValueOnce(fail(410, "Removed by owner"));

    const err: ClawHubError = await getSkillInfo({ slug: "old" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubError);
    expect(err.statusCode).toBe(410);
    expect(err.message).toBe("Removed by owner");
  });

  it("throws with 410 fallback when body is empty", async () => {
    mockFetch.mockResolvedValueOnce(fail(410));

    const err: ClawHubError = await getSkillInfo({ slug: "old" }).catch((e) => e);
    expect(err.message).toBe('Skill "old" has been removed.');
  });

  it("throws with generic message for unhandled status codes", async () => {
    mockFetch.mockResolvedValueOnce(fail(500, "Internal Server Error"));

    const err: ClawHubError = await getSkillInfo({ slug: "broken" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe("ClawHub API error 500: Internal Server Error");
  });

  it("handles response.text() failure gracefully", async () => {
    const brokenResponse = {
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error("stream error")),
    } as unknown as Response;
    mockFetch.mockResolvedValueOnce(brokenResponse);

    const err: ClawHubError = await getSkillInfo({ slug: "err" }).catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubError);
    expect(err.message).toBe("ClawHub API error 500: ");
  });
});
