import { createProviderRegistry, createGateway } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

type AnyProvider = Parameters<typeof createProviderRegistry>[0][string];

type ProviderConfig = {
  apiKey: string;
  baseUrl?: string;
};

type ProviderMeta = {
  id: string;
  displayName: string;
  exampleModels: string[];
};

export const SUPPORTED_PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    displayName: "Anthropic",
    exampleModels: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-6",
      "claude-haiku-4-5",
    ],
  },
  {
    id: "openai",
    displayName: "OpenAI",
    exampleModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
  {
    id: "google",
    displayName: "Google Generative AI",
    exampleModels: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ],
  },
  {
    id: "mistral",
    displayName: "Mistral",
    exampleModels: ["mistral-large-latest", "mistral-small-latest"],
  },
  {
    id: "xai",
    displayName: "xAI",
    exampleModels: ["grok-3", "grok-3-mini"],
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    exampleModels: [
      "anthropic/claude-sonnet-4",
      "openai/gpt-4o",
      "google/gemini-2.5-pro",
    ],
  },
  {
    id: "gateway",
    displayName: "Vercel AI Gateway",
    exampleModels: [
      "anthropic/claude-sonnet-4-20250514",
      "openai/gpt-4o",
    ],
  },
];

const PROVIDER_FACTORY_MAP: Record<
  string,
  (config: ProviderConfig) => AnyProvider
> = {
  anthropic: (c) =>
    createAnthropic({
      apiKey: c.apiKey,
      ...(c.baseUrl && { baseURL: c.baseUrl }),
    }) as AnyProvider,
  openai: (c) =>
    createOpenAI({
      apiKey: c.apiKey,
      ...(c.baseUrl && { baseURL: c.baseUrl }),
    }) as AnyProvider,
  google: (c) =>
    createGoogleGenerativeAI({
      apiKey: c.apiKey,
      ...(c.baseUrl && { baseURL: c.baseUrl }),
    }) as AnyProvider,
  mistral: (c) =>
    createMistral({
      apiKey: c.apiKey,
      ...(c.baseUrl && { baseURL: c.baseUrl }),
    }) as AnyProvider,
  xai: (c) =>
    createXai({
      apiKey: c.apiKey,
      ...(c.baseUrl && { baseURL: c.baseUrl }),
    }) as AnyProvider,
  openrouter: (c) =>
    createOpenRouter({
      apiKey: c.apiKey,
      ...(c.baseUrl && { baseURL: c.baseUrl }),
    }) as AnyProvider,
  gateway: (c) =>
    createGateway({
      apiKey: c.apiKey,
      ...(c.baseUrl && { baseURL: c.baseUrl }),
    }) as AnyProvider,
};

export function buildProviderRegistry({
  providers,
}: {
  providers: Record<string, ProviderConfig>;
}) {
  const registryInput: Record<string, AnyProvider> = {};

  for (const [key, config] of Object.entries(providers)) {
    const factory = PROVIDER_FACTORY_MAP[key];
    if (!factory) {
      console.warn(
        `[ai] Unknown provider "${key}" — skipping. Supported: ${Object.keys(PROVIDER_FACTORY_MAP).join(", ")}`,
      );
      continue;
    }
    registryInput[key] = factory(config);
  }

  return createProviderRegistry(registryInput);
}

export function resolveModelRef({
  ref,
  aliases,
}: {
  ref: string;
  aliases: Record<string, string>;
}): string {
  const resolved = aliases[ref];
  return resolved ?? ref;
}

export function parseModelRef({ ref }: { ref: string }): {
  providerKey: string;
  modelId: string;
} {
  const separatorIndex = ref.indexOf(":");
  if (separatorIndex === -1) {
    throw new Error(
      `Invalid model reference "${ref}": expected "provider:modelId" format`,
    );
  }
  return {
    providerKey: ref.slice(0, separatorIndex),
    modelId: ref.slice(separatorIndex + 1),
  };
}
