const CLAWHUB_API_BASE =
  process.env.CLAWHUB_REGISTRY ?? "https://clawhub.ai/api/v1";

export class ClawHubError extends Error {
  readonly statusCode: number;
  readonly slug: string;

  constructor({
    statusCode,
    slug,
    message,
  }: {
    statusCode: number;
    slug: string;
    message: string;
  }) {
    super(message);
    this.statusCode = statusCode;
    this.slug = slug;
  }
}

export type SkillInfo = {
  skill: {
    slug: string;
    displayName: string;
    summary: string | null;
    tags: Record<string, string>;
    stats: {
      downloads: number;
      stars: number;
      installsCurrent: number;
    };
    createdAt: number;
    updatedAt: number;
  };
  latestVersion: {
    version: string;
    createdAt: number;
    changelog: string;
  } | null;
  owner: {
    handle: string | null;
    displayName: string | null;
  } | null;
  moderation: {
    isSuspicious: boolean;
    isMalwareBlocked: boolean;
  } | null;
};

export type SkillVersionDetail = {
  skill: { slug: string; displayName: string };
  version: {
    version: string;
    createdAt: number;
    changelog: string;
    files: Array<{
      path: string;
      size: number;
      sha256: string;
      contentType: string | null;
    }>;
  };
};

export type SearchResult = {
  score: number;
  slug: string;
  displayName: string;
  summary: string | null;
  version: string | null;
  updatedAt: number;
};

async function handleErrorResponse({
  response,
  slug,
}: {
  response: Response;
  slug: string;
}): Promise<never> {
  const body = await response.text().catch(() => "");

  if (response.status === 404) {
    throw new ClawHubError({
      statusCode: 404,
      slug,
      message: `Skill "${slug}" not found on ClawHub.`,
    });
  }

  if (response.status === 403) {
    throw new ClawHubError({
      statusCode: 403,
      slug,
      message: body || `Skill "${slug}" is blocked by moderation.`,
    });
  }

  if (response.status === 423) {
    throw new ClawHubError({
      statusCode: 423,
      slug,
      message:
        body || `Skill "${slug}" is pending a security scan. Try again shortly.`,
    });
  }

  if (response.status === 410) {
    throw new ClawHubError({
      statusCode: 410,
      slug,
      message: body || `Skill "${slug}" has been removed.`,
    });
  }

  throw new ClawHubError({
    statusCode: response.status,
    slug,
    message: `ClawHub API error ${response.status}: ${body}`,
  });
}

export async function getSkillInfo({
  slug,
}: {
  slug: string;
}): Promise<SkillInfo> {
  const response = await fetch(`${CLAWHUB_API_BASE}/skills/${encodeURIComponent(slug)}`);

  if (!response.ok) {
    await handleErrorResponse({ response, slug });
  }

  return (await response.json()) as SkillInfo;
}

export async function getSkillVersionFiles({
  slug,
  version,
}: {
  slug: string;
  version: string;
}): Promise<SkillVersionDetail> {
  const response = await fetch(
    `${CLAWHUB_API_BASE}/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
  );

  if (!response.ok) {
    await handleErrorResponse({ response, slug });
  }

  return (await response.json()) as SkillVersionDetail;
}

export async function getSkillFileContent({
  slug,
  path,
  version,
}: {
  slug: string;
  path: string;
  version?: string;
}): Promise<string> {
  const params = new URLSearchParams({ path });
  if (version) {
    params.set("version", version);
  }

  const response = await fetch(
    `${CLAWHUB_API_BASE}/skills/${encodeURIComponent(slug)}/file?${params.toString()}`,
  );

  if (!response.ok) {
    await handleErrorResponse({ response, slug });
  }

  return response.text();
}

export async function searchSkills({
  query,
  limit,
}: {
  query: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) {
    params.set("limit", String(limit));
  }

  const response = await fetch(
    `${CLAWHUB_API_BASE}/search?${params.toString()}`,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ClawHub search failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { results: SearchResult[] };
  return data.results;
}
