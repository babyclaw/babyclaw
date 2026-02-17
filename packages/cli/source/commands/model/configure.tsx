import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import {
  getConfigPath,
  loadConfigRaw,
  writeConfig,
  getDefaultConfigTemplate,
  simpleclawConfigSchema,
  SUPPORTED_PROVIDERS,
  type SimpleclawConfig,
} from "@simpleclaw/gateway";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";

type ProviderEntry = {
  id: string;
  apiKey: string;
  baseUrl: string;
};

type WizardStep =
  | "loading"
  | "select-provider"
  | "enter-api-key"
  | "enter-base-url"
  | "provider-done"
  | "enter-chat-model"
  | "enter-browser-model"
  | "confirm"
  | "saving"
  | "done"
  | "error";

export default function ModelConfigure() {
  const [step, setStep] = useState<WizardStep>("loading");
  const [baseConfig, setBaseConfig] = useState<SimpleclawConfig | null>(null);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [currentProvider, setCurrentProvider] = useState<ProviderEntry | null>(
    null,
  );
  const [chatModel, setChatModel] = useState("");
  const [browserModel, setBrowserModel] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [inputValue, setInputValue] = useState("");

  useExit({ done: step === "done" || step === "error" });

  React.useEffect(() => {
    void (async () => {
      const existing = await loadConfigRaw();
      if (existing) {
        setBaseConfig(existing);
        const existingProviders = Object.entries(existing.ai.providers).map(
          ([id, cfg]) => ({
            id,
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl ?? "",
          }),
        );
        setProviders(existingProviders);
        setChatModel(existing.ai.models.chat);
        setBrowserModel(existing.ai.models.browser);
      } else {
        const template = JSON.parse(getDefaultConfigTemplate());
        const parsed = simpleclawConfigSchema.parse(template);
        setBaseConfig(parsed);
        setChatModel(parsed.ai.models.chat);
        setBrowserModel(parsed.ai.models.browser);
      }
      setStep("select-provider");
    })();
  }, []);

  const handleSelectProvider = (item: { value: string }) => {
    if (item.value === "__done__") {
      if (providers.length === 0) {
        return;
      }
      setInputValue(chatModel);
      setStep("enter-chat-model");
      return;
    }

    const existing = providers.find((p) => p.id === item.value);
    setCurrentProvider({
      id: item.value,
      apiKey: existing?.apiKey ?? "",
      baseUrl: existing?.baseUrl ?? "",
    });
    setInputValue(existing?.apiKey ?? "");
    setStep("enter-api-key");
  };

  const handleApiKeySubmit = () => {
    if (!currentProvider || !inputValue.trim()) return;
    setCurrentProvider({ ...currentProvider, apiKey: inputValue.trim() });
    setInputValue(currentProvider.baseUrl);
    setStep("enter-base-url");
  };

  const handleBaseUrlSubmit = () => {
    if (!currentProvider) return;
    const entry: ProviderEntry = {
      ...currentProvider,
      baseUrl: inputValue.trim(),
    };
    setProviders((prev) => {
      const idx = prev.findIndex((p) => p.id === entry.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = entry;
        return next;
      }
      return [...prev, entry];
    });
    setCurrentProvider(null);
    setInputValue("");
    setStep("select-provider");
  };

  const handleChatModelSubmit = () => {
    if (!inputValue.trim()) return;
    setChatModel(inputValue.trim());
    setInputValue(browserModel);
    setStep("enter-browser-model");
  };

  const handleBrowserModelSubmit = () => {
    if (!inputValue.trim()) return;
    setBrowserModel(inputValue.trim());
    setStep("confirm");
  };

  const handleConfirm = (item: { value: string }) => {
    if (item.value === "save") {
      void saveConfig();
    } else {
      setStep("select-provider");
    }
  };

  const saveConfig = async () => {
    setStep("saving");
    try {
      const providersObj: Record<
        string,
        { apiKey: string; baseUrl?: string }
      > = {};
      for (const p of providers) {
        providersObj[p.id] = {
          apiKey: p.apiKey,
          ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
        };
      }

      const config: SimpleclawConfig = {
        ...(baseConfig ?? ({} as SimpleclawConfig)),
        ai: {
          providers: providersObj,
          models: {
            chat: chatModel,
            browser: browserModel,
          },
          aliases: baseConfig?.ai.aliases ?? {},
        },
      };

      await writeConfig({ config });
      setStep("done");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  };

  if (step === "loading") {
    return <Text color={colors.muted}>Loading configuration...</Text>;
  }

  if (step === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>Failed to save configuration</Text>
        <Text color={colors.muted}>{errorMsg}</Text>
      </Box>
    );
  }

  if (step === "done") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.success}>
          Configuration saved to {getConfigPath()}
        </Text>
        <Text color={colors.muted}>
          {"  "}Run{" "}
          <Text color={colors.info}>simpleclaw config validate</Text> to verify,
          or <Text color={colors.info}>simpleclaw model</Text> to review.
        </Text>
      </Box>
    );
  }

  if (step === "saving") {
    return <Text color={colors.muted}>Saving configuration...</Text>;
  }

  if (step === "select-provider") {
    const providerItems = SUPPORTED_PROVIDERS.map((p) => {
      const configured = providers.find((e) => e.id === p.id);
      const label = configured
        ? `${p.displayName} (configured)`
        : p.displayName;
      return { label, value: p.id };
    });
    providerItems.push({
      label: providers.length > 0 ? "Done adding providers →" : "(add at least one provider first)",
      value: "__done__",
    });

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold> Model Provider Setup</Text>
        <Text color={colors.muted}>
          {"  "}Select a provider to configure (or choose Done when finished):
        </Text>
        {providers.length > 0 && (
          <Box flexDirection="column" paddingLeft={2}>
            <Text color={colors.muted}>
              Configured:{" "}
              {providers.map((p) => p.id).join(", ")}
            </Text>
          </Box>
        )}
        <Box paddingLeft={2}>
          <SelectInput items={providerItems} onSelect={handleSelectProvider} />
        </Box>
      </Box>
    );
  }

  if (step === "enter-api-key") {
    const meta = SUPPORTED_PROVIDERS.find(
      (p) => p.id === currentProvider?.id,
    );
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {"  "}Configure {meta?.displayName ?? currentProvider?.id}
        </Text>
        <Box paddingLeft={2}>
          <Text color={colors.info}>API Key: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleApiKeySubmit}
            mask="*"
          />
        </Box>
      </Box>
    );
  }

  if (step === "enter-base-url") {
    const meta = SUPPORTED_PROVIDERS.find(
      (p) => p.id === currentProvider?.id,
    );
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {"  "}Configure {meta?.displayName ?? currentProvider?.id}
        </Text>
        <Box paddingLeft={2}>
          <Text color={colors.muted}>
            Base URL (leave empty for default, press Enter to skip):
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={colors.info}>Base URL: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleBaseUrlSubmit}
          />
        </Box>
      </Box>
    );
  }

  if (step === "enter-chat-model") {
    const hint = providers.length > 0
      ? `e.g. ${providers[0]!.id}:${SUPPORTED_PROVIDERS.find((p) => p.id === providers[0]!.id)?.exampleModels[0] ?? "model-name"}`
      : "";
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold> Model Selection</Text>
        <Box paddingLeft={2}>
          <Text color={colors.muted}>
            Format: provider:model-id {hint && `(${hint})`}
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={colors.info}>Chat model: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleChatModelSubmit}
          />
        </Box>
      </Box>
    );
  }

  if (step === "enter-browser-model") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold> Model Selection</Text>
        <Box paddingLeft={2}>
          <Text color={colors.muted}>
            The browser model powers web automation (browser-use).
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <Text color={colors.info}>Browser model: </Text>
          <TextInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={handleBrowserModelSubmit}
          />
        </Box>
      </Box>
    );
  }

  if (step === "confirm") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold> Review Configuration</Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={colors.brand} bold>Providers:</Text>
          {providers.map((p) => (
            <Text key={p.id}>
              {"  "}
              <Text color={colors.success}>●</Text> {p.id}
              {p.baseUrl ? (
                <Text color={colors.muted}> [{p.baseUrl}]</Text>
              ) : null}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          <Text color={colors.brand} bold>Models:</Text>
          <Text>
            {"  "}chat: <Text color={colors.info}>{chatModel}</Text>
          </Text>
          <Text>
            {"  "}browser: <Text color={colors.info}>{browserModel}</Text>
          </Text>
        </Box>
        <Box paddingLeft={2}>
          <SelectInput
            items={[
              { label: "Save configuration", value: "save" },
              { label: "Go back and edit", value: "edit" },
            ]}
            onSelect={handleConfirm}
          />
        </Box>
      </Box>
    );
  }

  return null;
}
