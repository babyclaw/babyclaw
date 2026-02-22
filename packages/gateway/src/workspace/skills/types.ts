export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

export type OpenClawSkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillFrontmatter = {
  name: string;
  description: string;
  homepage?: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  commandDispatch?: string;
  commandTool?: string;
  commandArgMode?: string;
  openclaw?: OpenClawSkillMetadata;
};

export type SkillEntry = {
  frontmatter: SkillFrontmatter;
  slug: string;
  relativePath: string;
};

export function getSkillKey({
  frontmatter,
  slug,
}: {
  frontmatter: SkillFrontmatter | null;
  slug: string;
}): string {
  return frontmatter?.openclaw?.skillKey ?? frontmatter?.name ?? slug;
}

export type SkillsConfig = {
  entries: Record<
    string,
    {
      enabled: boolean;
      apiKey?: string;
      env?: Record<string, string>;
    }
  >;
};
