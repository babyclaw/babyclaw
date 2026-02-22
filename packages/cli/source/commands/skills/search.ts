import { command } from "@gud/cli";
import {
  loadConfigRaw,
  installSkillFromClawHub,
  runSkillSetup,
  resolveLanguageModel,
  resolveWorkspaceRoot,
  SkillAlreadyInstalledError,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

const CLAWHUB_SEARCH_URL = "https://clawhub.ai/api/v1/search";

type SearchResult = {
  score: number;
  slug: string;
  displayName: string;
  summary: string;
  version: string;
  updatedAt: number;
};

type SearchResponse = {
  results: SearchResult[];
};

export default command({
  description: "Search for skills on ClawHub",
  options: {
    query: {
      type: "string",
      description: "Search query (e.g. notion, calendar, git)",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output raw JSON instead of formatted results",
    },
  },
  handler: async ({ options, client }) => {
    const query = await options.query({ prompt: "Search query" });
    const json = await options.json();

    const url = `${CLAWHUB_SEARCH_URL}?q=${encodeURIComponent(query)}`;

    let data: SearchResponse;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        client.log(c.error(`✗ ClawHub API returned ${res.status}`));
        process.exitCode = 1;
        return;
      }
      data = (await res.json()) as SearchResponse;
    } catch (error) {
      client.log(c.error("✗ Failed to reach ClawHub API"));
      client.log(c.muted(`  ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
      return;
    }

    if (data.results.length === 0) {
      client.log(c.warning(`No skills found for "${query}".`));
      client.log(c.muted("  Browse all skills at ") + c.info("https://clawhub.ai/skills"));
      return;
    }

    if (json) {
      client.log(JSON.stringify(data.results, null, 2));
      return;
    }

    client.log(
      c.bold(
        ` 🔍 ${data.results.length} result${data.results.length !== 1 ? "s" : ""} for "${query}"`,
      ) + "\n",
    );

    const choices = data.results.map((r) => ({
      title: `${r.displayName} ${c.muted("v" + r.version)} — ${r.summary}`,
      value: r.slug,
    }));
    choices.push({ title: c.muted("Cancel"), value: "__cancel__" });

    const selected = await client.prompt({
      type: "select",
      message: "Select a skill to install",
      choices,
    });

    if (selected === "__cancel__") {
      return;
    }

    const slug = selected as string;
    const skill = data.results.find((r) => r.slug === slug)!;

    client.log("");

    try {
      const config = await loadConfigRaw();
      const workspacePath = resolveWorkspaceRoot({
        configRoot: config?.workspace?.root ?? "~/babyclaw",
      });

      const installResult = await installSkillFromClawHub({
        slug,
        workspacePath,
        force: false,
      });

      let setupResult = null;
      let setupError: string | null = null;

      if (config) {
        try {
          const model = resolveLanguageModel({ config });
          setupResult = await runSkillSetup({
            model,
            skillPath: installResult.skillPath,
            workspacePath,
          });
        } catch (err) {
          setupError = err instanceof Error ? err.message : String(err);
        }
      }

      client.log(
        c.success("✓ Installed ") +
          c.bold(installResult.displayName) +
          c.muted(` (${installResult.version})`),
      );
      client.log(
        c.muted(
          `  ${installResult.files.length} file${installResult.files.length !== 1 ? "s" : ""} → ${installResult.skillPath}`,
        ),
      );

      if (setupResult && !setupResult.skipped) {
        client.log(c.success("  ✓ Dependencies set up"));
      }
      if (setupError) {
        client.log(c.warning("  ⚠ Setup failed (skill files are still installed)"));
        client.log(c.muted(`    ${setupError}`));
      }

      client.log(c.muted("  The skill will be available on the next agent session."));
    } catch (error) {
      if (error instanceof SkillAlreadyInstalledError) {
        client.log(c.warning(`⚠ Skill "${skill.displayName}" is already installed.`));
        client.log(
          c.muted("  Use ") +
            c.info(`babyclaw skill install --slug ${slug} --force`) +
            c.muted(" to overwrite."),
        );
        return;
      }

      client.log(c.error(`✗ Failed to install "${skill.displayName}"`));
      client.log(c.muted(`  ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
    }
  },
});
