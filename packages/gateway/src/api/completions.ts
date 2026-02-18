import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type {
  ImagePart,
  ModelMessage,
  TextPart,
  ToolSet,
  UserContent,
} from "ai";
import { AiAgent } from "../ai/agent.js";
import {
  getBrowserToolsSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSelfManagementSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
  readToolNotes,
} from "../ai/prompts.js";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import { getLogger } from "../logging/index.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
} from "../onboarding/personality.js";
import type { GatewayStatus } from "../runtime.js";
import { SchedulerService } from "../scheduler/service.js";
import { createUnifiedTools } from "../tools/registry.js";
import { readBootstrapGuide, readWorkspaceGuide } from "../workspace/bootstrap.js";
import {
  getEligibleSkills,
  scanWorkspaceSkills,
} from "../workspace/skills/index.js";
import type { SkillsConfig } from "../workspace/skills/types.js";
import {
  OpenAiHttpError,
  sendJson,
} from "./errors.js";

type CreateChatCompletionsHandlerInput = {
  workspacePath: string;
  aiAgent: AiAgent;
  schedulerService: SchedulerService;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  braveSearchApiKey: string | null;
  shellConfig: ShellConfig;
  browserMcpClient?: BrowserMcpClient;
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
  getStatus: () => GatewayStatus;
  adminSocketPath: string;
  logOutput: string;
  logLevel: string;
  schedulerActive: boolean;
  heartbeatActive: boolean;
  restartGateway: () => Promise<void>;
  responseModel: string;
  createTools?: typeof createUnifiedTools;
};

type HandleCompletionsInput = {
  body: unknown;
  response: ServerResponse;
  abortSignal?: AbortSignal;
};

type ParsedCompletionsRequest = {
  stream: boolean;
  messages: ModelMessage[];
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
};

type OpenAiFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "function_call";

type ChatCompletionsHandler = {
  handle(input: HandleCompletionsInput): Promise<void>;
};

const SUPPORTED_TOP_LEVEL_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "user",
  "metadata",
  "service_tier",
  "n",
  "tools",
  "tool_choice",
  "functions",
  "function_call",
  "stream_options",
]);

const API_TOOL_CHAT_ID = "0";
const API_TOOL_USER_ID = "0";
const MAX_AGENT_STEPS = 50;

export function createChatCompletionsHandler({
  workspacePath,
  aiAgent,
  schedulerService,
  syncSchedule,
  enableGenericTools,
  braveSearchApiKey,
  shellConfig,
  browserMcpClient,
  skillsConfig,
  fullConfig,
  getStatus,
  adminSocketPath,
  logOutput,
  logLevel,
  schedulerActive,
  heartbeatActive,
  restartGateway,
  responseModel,
  createTools = createUnifiedTools,
}: CreateChatCompletionsHandlerInput): ChatCompletionsHandler {
  return {
    async handle({ body, response, abortSignal }: HandleCompletionsInput): Promise<void> {
      const parsed = parseCompletionsRequest({ body });
      const requestMessages = parsed.messages;

      const [
        personalityFiles,
        toolNotesContent,
        agentsContent,
        bootstrapContent,
        allSkills,
      ] = await Promise.all([
        readPersonalityFiles({ workspacePath }),
        readToolNotes({ workspacePath }),
        readWorkspaceGuide({ workspacePath }),
        readBootstrapGuide({ workspacePath }),
        scanWorkspaceSkills({ workspacePath }),
      ]);

      const skills = getEligibleSkills({
        skills: allSkills,
        skillsConfig,
        fullConfig,
      });
      const completePersonality = hasCompletePersonalityFiles(personalityFiles)
        ? personalityFiles
        : undefined;

      const messages: ModelMessage[] = [
        getSharedSystemMessage({
          workspacePath,
          personalityFiles: completePersonality,
        }),
        getWorkspaceGuideSystemMessage({
          agentsContent,
          bootstrapContent,
        }),
        getSkillsSystemMessage({
          skills,
          toolNotesContent,
        }),
        getSchedulerGuidanceSystemMessage(),
        getSelfManagementSystemMessage({
          configPath: getStatus().configPath ?? "~/.simpleclaw/simpleclaw.json",
          adminSocketPath,
          logOutput,
        }),
        ...(browserMcpClient ? [getBrowserToolsSystemMessage()] : []),
        ...requestMessages,
      ];

      const sourceText = extractSourceText({ messages: requestMessages });
      const tools = createTools({
        executionContext: {
          workspaceRoot: workspacePath,
          botTimezone: schedulerService.getTimezone(),
          platform: "openai-api",
          chatId: API_TOOL_CHAT_ID,
          runSource: "chat",
          isMainSession: false,
        },
        schedulerService,
        syncSchedule,
        sourceText,
        createdByUserId: API_TOOL_USER_ID,
        enableGenericTools,
        braveSearchApiKey,
        shellConfig,
        browserMcpClient,
        getStatus,
        adminSocketPath,
        logOutput,
        logLevel,
        schedulerActive,
        heartbeatActive,
        getActiveTurnCount: () => 0,
        restartGateway,
      });

      const streamResult = aiAgent.chatStreamWithTools({
        messages,
        tools,
        maxSteps: MAX_AGENT_STEPS,
        abortSignal,
        temperature: parsed.temperature,
        topP: parsed.topP,
        maxOutputTokens: parsed.maxOutputTokens,
        stopSequences: parsed.stopSequences,
      });

      const completionId = `chatcmpl-${randomUUID().replace(/-/g, "")}`;
      const created = Math.floor(Date.now() / 1000);

      if (!parsed.stream) {
        const text = (await streamResult.text).trim();
        sendJson({
          response,
          status: 200,
          body: {
            id: completionId,
            object: "chat.completion",
            created,
            model: responseModel,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: text,
                },
                finish_reason: "stop",
              },
            ],
          },
        });
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });

      writeSseChunk({
        response,
        payload: {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: responseModel,
          choices: [
            {
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
            },
          ],
        },
      });

      let finishReason: OpenAiFinishReason = "stop";
      try {
        for await (const part of streamResult.fullStream as AsyncIterable<unknown>) {
          if (isTextDeltaPart(part)) {
            writeSseChunk({
              response,
              payload: {
                id: completionId,
                object: "chat.completion.chunk",
                created,
                model: responseModel,
                choices: [
                  {
                    index: 0,
                    delta: { content: part.text },
                    finish_reason: null,
                  },
                ],
              },
            });
            continue;
          }

          if (isFinishPart(part)) {
            finishReason = mapFinishReason({
              rawFinishReason: part.finishReason,
            });
          }
        }
      } catch (error) {
        if (abortSignal?.aborted) {
          response.end();
          return;
        }
        getLogger().error({ err: error }, "Failed while streaming chat completion");
      }

      writeSseChunk({
        response,
        payload: {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model: responseModel,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason,
            },
          ],
        },
      });

      response.write("data: [DONE]\n\n");
      response.end();
    },
  };
}

function parseCompletionsRequest({
  body,
}: {
  body: unknown;
}): ParsedCompletionsRequest {
  if (!isRecord(body)) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Request body must be a JSON object.",
    });
  }

  validateTopLevelKeys({ body });
  validateUnsupportedFields({ body });

  const model = body.model;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected `model` to be a non-empty string.",
      param: "model",
      code: "invalid_model",
    });
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected `messages` to be a non-empty array.",
      param: "messages",
      code: "invalid_messages",
    });
  }

  const stream = body.stream === true;
  const temperature = parseOptionalNumber({
    value: body.temperature,
    param: "temperature",
    min: 0,
    max: 2,
  });
  const topP = parseOptionalNumber({
    value: body.top_p,
    param: "top_p",
    min: 0,
    max: 1,
  });
  const maxOutputTokens = parseOptionalPositiveInteger({
    primaryValue: body.max_completion_tokens,
    primaryParam: "max_completion_tokens",
    fallbackValue: body.max_tokens,
    fallbackParam: "max_tokens",
  });
  const stopSequences = parseStopSequences({
    value: body.stop,
  });

  return {
    stream,
    messages: normalizeMessages({
      rawMessages,
    }),
    temperature,
    topP,
    maxOutputTokens,
    stopSequences,
  };
}

function validateTopLevelKeys({
  body,
}: {
  body: Record<string, unknown>;
}): void {
  for (const key of Object.keys(body)) {
    if (SUPPORTED_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }

    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: `Unsupported parameter: '${key}'.`,
      param: key,
      code: "unsupported_parameter",
    });
  }
}

function validateUnsupportedFields({
  body,
}: {
  body: Record<string, unknown>;
}): void {
  if (typeof body.n === "number" && body.n !== 1) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Only n=1 is supported.",
      param: "n",
      code: "unsupported_parameter",
    });
  }

  const unsupportedFields = [
    "tools",
    "tool_choice",
    "functions",
    "function_call",
  ] as const;

  for (const field of unsupportedFields) {
    if (body[field] === undefined) {
      continue;
    }
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: `Parameter '${field}' is not supported by this endpoint.`,
      param: field,
      code: "unsupported_parameter",
    });
  }

  if (body.stream_options !== undefined) {
    if (!isRecord(body.stream_options)) {
      throw new OpenAiHttpError({
        status: 400,
        type: "invalid_request_error",
        message: "Expected `stream_options` to be an object.",
        param: "stream_options",
        code: "invalid_type",
      });
    }
    if (body.stream_options.include_usage === true) {
      throw new OpenAiHttpError({
        status: 400,
        type: "invalid_request_error",
        message: "`stream_options.include_usage` is not supported.",
        param: "stream_options.include_usage",
        code: "unsupported_parameter",
      });
    }
  }
}

function normalizeMessages({
  rawMessages,
}: {
  rawMessages: unknown[];
}): ModelMessage[] {
  return rawMessages.map((rawMessage, index) =>
    normalizeMessage({
      rawMessage,
      index,
    })
  );
}

function normalizeMessage({
  rawMessage,
  index,
}: {
  rawMessage: unknown;
  index: number;
}): ModelMessage {
  const paramPrefix = `messages[${index}]`;
  if (!isRecord(rawMessage)) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Each message must be an object.",
      param: paramPrefix,
      code: "invalid_message",
    });
  }

  const roleValue = rawMessage.role;
  if (typeof roleValue !== "string") {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Each message must include a valid `role`.",
      param: `${paramPrefix}.role`,
      code: "invalid_role",
    });
  }

  switch (roleValue) {
    case "developer":
    case "system": {
      const content = parseTextOnlyContent({
        value: rawMessage.content,
        paramPrefix: `${paramPrefix}.content`,
        allowNull: false,
        allowRefusalPart: false,
      });
      return {
        role: "system",
        content,
      };
    }
    case "user": {
      const content = parseUserContent({
        value: rawMessage.content,
        paramPrefix: `${paramPrefix}.content`,
      });
      return {
        role: "user",
        content,
      };
    }
    case "assistant": {
      if (rawMessage.tool_calls !== undefined) {
        throw new OpenAiHttpError({
          status: 400,
          type: "invalid_request_error",
          message: "Assistant `tool_calls` messages are not supported.",
          param: `${paramPrefix}.tool_calls`,
          code: "unsupported_parameter",
        });
      }
      if (rawMessage.function_call !== undefined) {
        throw new OpenAiHttpError({
          status: 400,
          type: "invalid_request_error",
          message: "Assistant `function_call` messages are not supported.",
          param: `${paramPrefix}.function_call`,
          code: "unsupported_parameter",
        });
      }

      const content = parseTextOnlyContent({
        value: rawMessage.content,
        paramPrefix: `${paramPrefix}.content`,
        allowNull: true,
        allowRefusalPart: true,
      });
      const refusal = parseOptionalString({
        value: rawMessage.refusal,
        param: `${paramPrefix}.refusal`,
      });

      return {
        role: "assistant",
        content: refusal ? [content, refusal].filter((x) => x.length > 0).join("\n") : content,
      };
    }
    case "tool": {
      const toolCallId = parseRequiredString({
        value: rawMessage.tool_call_id,
        param: `${paramPrefix}.tool_call_id`,
      });
      const content = parseTextOnlyContent({
        value: rawMessage.content,
        paramPrefix: `${paramPrefix}.content`,
        allowNull: false,
        allowRefusalPart: false,
      });

      return {
        role: "user",
        content: `[Tool result: ${toolCallId}]\n${content}`,
      };
    }
    default:
      throw new OpenAiHttpError({
        status: 400,
        type: "invalid_request_error",
        message: `Unsupported message role: '${roleValue}'.`,
        param: `${paramPrefix}.role`,
        code: "invalid_role",
      });
  }
}

function parseUserContent({
  value,
  paramPrefix,
}: {
  value: unknown;
  paramPrefix: string;
}): UserContent {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected user message content to be a string or non-empty array of parts.",
      param: paramPrefix,
      code: "invalid_content",
    });
  }

  const parts: Array<TextPart | ImagePart> = [];
  let hasImage = false;

  for (let idx = 0; idx < value.length; idx += 1) {
    const part = value[idx];
    const partPrefix = `${paramPrefix}[${idx}]`;
    if (!isRecord(part)) {
      throw new OpenAiHttpError({
        status: 400,
        type: "invalid_request_error",
        message: "Each content part must be an object.",
        param: partPrefix,
        code: "invalid_content_part",
      });
    }

    const partType = part.type;
    if (partType === "text") {
      const text = parseRequiredString({
        value: part.text,
        param: `${partPrefix}.text`,
      });
      parts.push({
        type: "text",
        text,
      });
      continue;
    }

    if (partType === "image_url") {
      if (!isRecord(part.image_url)) {
        throw new OpenAiHttpError({
          status: 400,
          type: "invalid_request_error",
          message: "Expected `image_url` to be an object.",
          param: `${partPrefix}.image_url`,
          code: "invalid_content_part",
        });
      }
      const imageUrl = parseRequiredString({
        value: part.image_url.url,
        param: `${partPrefix}.image_url.url`,
      });
      parts.push({
        type: "image",
        image: imageUrl,
      });
      hasImage = true;
      continue;
    }

    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: `Unsupported content part type: '${String(partType)}'.`,
      param: `${partPrefix}.type`,
      code: "unsupported_content_type",
    });
  }

  if (!hasImage) {
    const joinedText = parts
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => part.text)
      .join("");
    return joinedText;
  }

  return parts;
}

function parseTextOnlyContent({
  value,
  paramPrefix,
  allowNull,
  allowRefusalPart,
}: {
  value: unknown;
  paramPrefix: string;
  allowNull: boolean;
  allowRefusalPart: boolean;
}): string {
  if (value === null && allowNull) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected message content to be a string or non-empty array.",
      param: paramPrefix,
      code: "invalid_content",
    });
  }

  const chunks: string[] = [];
  for (let idx = 0; idx < value.length; idx += 1) {
    const part = value[idx];
    const partPrefix = `${paramPrefix}[${idx}]`;
    if (!isRecord(part)) {
      throw new OpenAiHttpError({
        status: 400,
        type: "invalid_request_error",
        message: "Each content part must be an object.",
        param: partPrefix,
        code: "invalid_content_part",
      });
    }

    if (part.type === "text") {
      chunks.push(
        parseRequiredString({
          value: part.text,
          param: `${partPrefix}.text`,
        })
      );
      continue;
    }

    if (part.type === "refusal" && allowRefusalPart) {
      chunks.push(
        parseRequiredString({
          value: part.refusal,
          param: `${partPrefix}.refusal`,
        })
      );
      continue;
    }

    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: `Unsupported content part type: '${String(part.type)}'.`,
      param: `${partPrefix}.type`,
      code: "unsupported_content_type",
    });
  }

  return chunks.join("");
}

function parseOptionalString({
  value,
  param,
}: {
  value: unknown;
  param: string;
}): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected a string value.",
      param,
      code: "invalid_type",
    });
  }
  return value;
}

function parseRequiredString({
  value,
  param,
}: {
  value: unknown;
  param: string;
}): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected a non-empty string value.",
      param,
      code: "invalid_type",
    });
  }
  return value;
}

function parseOptionalNumber({
  value,
  param,
  min,
  max,
}: {
  value: unknown;
  param: string;
  min: number;
  max: number;
}): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected a finite number.",
      param,
      code: "invalid_type",
    });
  }
  if (value < min || value > max) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: `Expected value between ${min} and ${max}.`,
      param,
      code: "invalid_value",
    });
  }
  return value;
}

function parseOptionalPositiveInteger({
  primaryValue,
  primaryParam,
  fallbackValue,
  fallbackParam,
}: {
  primaryValue: unknown;
  primaryParam: string;
  fallbackValue: unknown;
  fallbackParam: string;
}): number | undefined {
  if (primaryValue !== undefined) {
    return parsePositiveInteger({
      value: primaryValue,
      param: primaryParam,
    });
  }

  if (fallbackValue !== undefined) {
    return parsePositiveInteger({
      value: fallbackValue,
      param: fallbackParam,
    });
  }

  return undefined;
}

function parsePositiveInteger({
  value,
  param,
}: {
  value: unknown;
  param: string;
}): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Expected a positive integer.",
      param,
      code: "invalid_type",
    });
  }
  return value;
}

function parseStopSequences({
  value,
}: {
  value: unknown;
}): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    const sequences = value.map((entry, index) =>
      parseRequiredString({
        value: entry,
        param: `stop[${index}]`,
      })
    );
    if (sequences.length === 0) {
      throw new OpenAiHttpError({
        status: 400,
        type: "invalid_request_error",
        message: "Expected `stop` array to contain at least one string.",
        param: "stop",
        code: "invalid_type",
      });
    }
    return sequences;
  }
  throw new OpenAiHttpError({
    status: 400,
    type: "invalid_request_error",
    message: "Expected `stop` to be a string or array of strings.",
    param: "stop",
    code: "invalid_type",
  });
}

function extractSourceText({
  messages,
}: {
  messages: ModelMessage[];
}): string {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) {
    return "";
  }

  const content = lastUser.content;
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((part): part is TextPart => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function writeSseChunk({
  response,
  payload,
}: {
  response: ServerResponse;
  payload: unknown;
}): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function isTextDeltaPart(part: unknown): part is { type: "text-delta"; text: string } {
  return (
    isRecord(part) &&
    part.type === "text-delta" &&
    typeof part.text === "string"
  );
}

function isFinishPart(part: unknown): part is { type: "finish"; finishReason?: string } {
  return isRecord(part) && part.type === "finish";
}

function mapFinishReason({
  rawFinishReason,
}: {
  rawFinishReason: unknown;
}): OpenAiFinishReason {
  switch (rawFinishReason) {
    case "length":
      return "length";
    case "tool_calls":
    case "tool-calls":
      return "tool_calls";
    case "content_filter":
    case "content-filter":
      return "content_filter";
    case "function_call":
    case "function-call":
      return "function_call";
    default:
      return "stop";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type { CreateChatCompletionsHandlerInput, ChatCompletionsHandler };
