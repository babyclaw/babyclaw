import type { Client } from "@gud/cli";
import { SUPPORTED_PROVIDERS } from "@babyclaw/gateway";

type ProviderEntry = {
  id: string;
};

type ModelChoice = {
  title: string;
  value?: string;
};

export async function promptForModel({
  client,
  providers,
  initial,
}: {
  client: Client;
  providers: ProviderEntry[];
  initial?: string;
}): Promise<string> {
  const knownModels = providers.flatMap((p) => {
    const meta = SUPPORTED_PROVIDERS.find((m) => m.id === p.id);
    return (meta?.exampleModels ?? []).map((m) => `${p.id}:${m}`);
  });

  if (knownModels.length === 0) {
    return (await client.prompt({
      type: "text",
      message: "Chat model (provider:model-id)",
      initial,
    })) as string;
  }

  const baseChoices: ModelChoice[] = knownModels.map((m) => ({ title: m, value: m }));

  const suggest = (input: string, choices: ModelChoice[]) => {
    if (!input) return Promise.resolve(choices);

    const needle = input.toLowerCase();
    const filtered = choices.filter((ch) => ch.title.toLowerCase().includes(needle));

    const exactMatch = choices.some((ch) => ch.value?.toLowerCase() === needle);
    if (!exactMatch && input.includes(":")) {
      filtered.push({ title: `${input}  (custom)`, value: input });
    }

    return Promise.resolve(filtered.length > 0 ? filtered : [{ title: `${input}  (custom)`, value: input }]);
  };

  return (await client.prompt({
    type: "autocomplete",
    message: "Chat model (type to search, or enter provider:model-id)",
    choices: baseChoices,
    initial,
    suggest,
  })) as string;
}
