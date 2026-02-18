import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import zod from "zod";
import { argument } from "pastel";
import { resolve } from "node:path";
import {
  loadConfigRaw,
  installSkillFromClawHub,
  SkillAlreadyInstalledError,
  ClawHubError,
} from "@simpleclaw/gateway";
import type { InstallSkillResult } from "@simpleclaw/gateway";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";

export const args = zod.tuple([
  zod.string().describe(
    argument({
      name: "slug",
      description: "Skill slug on ClawHub (e.g. gcalcli-calendar)",
    }),
  ),
]);

export const options = zod.object({
  version: zod
    .string()
    .optional()
    .describe("Install a specific version (defaults to latest)"),
  force: zod
    .boolean()
    .default(false)
    .describe("Overwrite if the skill is already installed"),
});

type Props = {
  args: zod.infer<typeof args>;
  options: zod.infer<typeof options>;
};

type State =
  | "resolving"
  | "installing"
  | "done"
  | "already-installed"
  | "not-found"
  | "error";

export default function SkillInstall({ args: positional, options: opts }: Props) {
  const slug = positional[0];
  const [state, setState] = useState<State>("resolving");
  const [result, setResult] = useState<InstallSkillResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useExit({ done: state !== "resolving" && state !== "installing" });

  useEffect(() => {
    void (async () => {
      try {
        const config = await loadConfigRaw();
        const workspacePath = resolve(
          process.cwd(),
          config?.workspace?.root ?? ".",
        );

        setState("installing");

        const installResult = await installSkillFromClawHub({
          slug,
          version: opts.version,
          workspacePath,
          force: opts.force,
        });

        setResult(installResult);
        setState("done");
      } catch (error) {
        if (error instanceof SkillAlreadyInstalledError) {
          setState("already-installed");
          return;
        }

        if (error instanceof ClawHubError && error.statusCode === 404) {
          setState("not-found");
          return;
        }

        setErrorMsg(error instanceof Error ? error.message : String(error));
        setState("error");
      }
    })();
  }, [slug, opts.version, opts.force]);

  if (state === "resolving") {
    return <Text color={colors.muted}>Resolving skill "{slug}"...</Text>;
  }

  if (state === "installing") {
    return <Text color={colors.muted}>Installing skill "{slug}"...</Text>;
  }

  if (state === "not-found") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Skill "{slug}" not found on ClawHub.</Text>
        <Text color={colors.muted}>
          {"  "}Browse available skills at{" "}
          <Text color={colors.info}>https://clawhub.ai/skills</Text>
        </Text>
      </Box>
    );
  }

  if (state === "already-installed") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.warning}>⚠ Skill "{slug}" is already installed.</Text>
        <Text color={colors.muted}>
          {"  "}Use <Text color={colors.info}>--force</Text> to overwrite.
        </Text>
      </Box>
    );
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Failed to install skill "{slug}"</Text>
        <Text color={colors.muted}>  {errorMsg}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.success}>
        ✓ Installed{" "}
        <Text bold>{result!.displayName}</Text>
        <Text color={colors.muted}> ({result!.version})</Text>
      </Text>
      <Text color={colors.muted}>
        {"  "}{result!.files.length} file{result!.files.length !== 1 ? "s" : ""} →{" "}
        {result!.skillPath}
      </Text>
      <Text color={colors.muted}>
        {"  "}The skill will be available on the next agent session.
      </Text>
    </Box>
  );
}
