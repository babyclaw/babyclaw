import {
  generateObject,
  generateText,
  hasToolCall,
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import { getLogger } from "../logging/index.js";

type CreateAgentInput = {
  model: LanguageModel;
};

type ChatInput = {
  messages: ModelMessage[];
};

type ChatStreamResult = {
  textStream: AsyncIterable<string>;
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>;
  text: PromiseLike<string>;
};

type StopCondition = ReturnType<typeof hasToolCall>;

type ChatStreamWithToolsInput<TTools extends ToolSet = ToolSet> = {
  messages: ModelMessage[];
  tools: TTools;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  extraStopConditions?: StopCondition[];
  model?: LanguageModel;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
};

type ChatWithToolsInput<TTools extends ToolSet = ToolSet> = {
  messages: ModelMessage[];
  tools: TTools;
  maxSteps?: number;
};

type ForceToolCallInput<TSchema extends z.ZodTypeAny> = {
  messages: ModelMessage[];
  toolName: string;
  description: string;
  inputSchema: TSchema;
};

type GenerateStructuredInput<TSchema extends z.ZodTypeAny> = {
  messages: ModelMessage[];
  schema: TSchema;
};

export class AiAgent {
  private readonly model: LanguageModel;

  constructor({ model }: CreateAgentInput) {
    this.model = model;
  }

  async chat({ messages }: ChatInput): Promise<string> {
    const result = await generateText({
      model: this.model,
      messages,
    });

    return result.text.trim();
  }

  chatStream({ messages }: ChatInput): ChatStreamResult {
    const result = streamText({
      model: this.model,
      messages,
    });

    return {
      textStream: result.textStream,
      fullStream: result.fullStream,
      text: result.text,
    };
  }

  chatStreamWithTools<TTools extends ToolSet>({
    messages,
    tools,
    maxSteps = 50,
    abortSignal,
    extraStopConditions,
    model,
    temperature,
    topP,
    maxOutputTokens,
    stopSequences,
  }: ChatStreamWithToolsInput<TTools>): ChatStreamResult {
    const request = {
      model: model ?? this.model,
      messages,
      tools,
      stopWhen: [stepCountIs(maxSteps), ...(extraStopConditions ?? [])],
      abortSignal,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(stopSequences && stopSequences.length > 0 ? { stopSequences } : {}),
      onAbort: ({ steps }) => {
        getLogger().info({ steps: steps.length }, "Agent turn aborted");
      },
      onStepFinish({
        text,
        reasoningText,
        toolCalls,
      }) {
        getLogger().info({ 
          text,
          reasoningText,
          toolCallsCount: toolCalls.length,
         }, "Agent step finished");
      }
    } as Parameters<typeof streamText>[0];

    const result = streamText(request);

    return {
      textStream: result.textStream,
      fullStream: result.fullStream,
      text: result.text,
    };
  }

  async chatWithTools<TTools extends ToolSet>({
    messages,
    tools,
    maxSteps = 50,
  }: ChatWithToolsInput<TTools>): Promise<string> {
    const result = await generateText({
      model: this.model,
      messages,
      tools,
      stopWhen: stepCountIs(maxSteps),
      onStepFinish(stepResult) {
        getLogger().info({ stepResult }, "Agent step finished");
      }
    });

    return result.text.trim();
  }

  async forceToolCall<TSchema extends z.ZodTypeAny>({
    messages,
    toolName,
    description,
    inputSchema,
  }: ForceToolCallInput<TSchema>): Promise<z.infer<TSchema>> {
    const forcedTool = tool({ description, inputSchema });

    const result = await generateText({
      model: this.model,
      messages,
      tools: { [toolName]: forcedTool } as ToolSet,
      toolChoice: { type: "tool", toolName },
    });

    const firstCall = result.toolCalls[0];
    if (!firstCall) {
      throw new Error(`Forced tool call to "${toolName}" produced no result`);
    }

    return firstCall.input as z.infer<TSchema>;
  }

  async generateStructured<TSchema extends z.ZodTypeAny>({
    messages,
    schema,
  }: GenerateStructuredInput<TSchema>): Promise<z.infer<TSchema>> {
    const result = await generateObject({
      model: this.model,
      messages,
      schema,
    });

    return result.object as z.infer<TSchema>;
  }
}
