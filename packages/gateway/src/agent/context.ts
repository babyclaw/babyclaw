import { readToolNotes } from "../ai/prompts.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
  type CompletePersonalityFiles,
} from "../onboarding/personality.js";
import { readWorkspaceGuide } from "../workspace/bootstrap.js";
import { scanWorkspaceSkills, getEligibleSkills } from "../workspace/skills/index.js";
import type { SkillEntry, SkillsConfig } from "../workspace/skills/types.js";

export type AgentContext = {
  personalityFiles: CompletePersonalityFiles | undefined;
  toolNotesContent: string | undefined;
  agentsContent: string | undefined;
  skills: SkillEntry[];
};

export async function loadAgentContext({
  workspacePath,
  skillsConfig,
  fullConfig,
}: {
  workspacePath: string;
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
}): Promise<AgentContext> {
  const [rawPersonalityFiles, toolNotesContent, agentsContent, allSkills] =
    await Promise.all([
      readPersonalityFiles({ workspacePath }),
      readToolNotes({ workspacePath }),
      readWorkspaceGuide({ workspacePath }),
      scanWorkspaceSkills({ workspacePath }),
    ]);

  const skills = getEligibleSkills({ skills: allSkills, skillsConfig, fullConfig });

  const personalityFiles = hasCompletePersonalityFiles(rawPersonalityFiles)
    ? rawPersonalityFiles
    : undefined;

  return { personalityFiles, toolNotesContent, agentsContent, skills };
}
