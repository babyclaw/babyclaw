import {
  createGateway,
  generateObject,
  generateText,
  stepCountIs,
  streamText,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type { z } from "zod";

type CreateAgentInput = {
  apiKey: string;
  modelId?: string;
};

type ChatInput = {
  messages: ModelMessage[];
};

type ChatStreamResult = {
  textStream: AsyncIterable<string>;
  text: PromiseLike<string>;
};

type ChatStreamWithToolsInput<TTools extends ToolSet = ToolSet> = {
  messages: ModelMessage[];
  tools: TTools;
  maxSteps?: number;
  abortSignal?: AbortSignal;
};

type ChatWithToolsInput<TTools extends ToolSet = ToolSet> = {
  messages: ModelMessage[];
  tools: TTools;
  maxSteps?: number;
};

type GenerateStructuredInput<TSchema extends z.ZodTypeAny> = {
  messages: ModelMessage[];
  schema: TSchema;
};

const DEFAULT_MODEL_ID = "anthropic/claude-sonnet-4-20250514";

export class AiAgent {
  private readonly modelId: string;
  private readonly gateway: ReturnType<typeof createGateway>;

  constructor({ apiKey, modelId = DEFAULT_MODEL_ID }: CreateAgentInput) {
    this.modelId = modelId;
    this.gateway = createGateway({ apiKey });
  }

  async chat({ messages }: ChatInput): Promise<string> {
    const result = await generateText({
      model: this.gateway(this.modelId),
      messages,
    });

    return result.text.trim();
  }

  chatStream({ messages }: ChatInput): ChatStreamResult {
    const result = streamText({
      model: this.gateway(this.modelId),
      messages,
    });

    return {
      textStream: result.textStream,
      text: result.text,
    };
  }

  chatStreamWithTools<TTools extends ToolSet>({
    messages,
    tools,
    maxSteps = 50,
    abortSignal,
  }: ChatStreamWithToolsInput<TTools>): ChatStreamResult {
    const result = streamText({
      model: this.gateway(this.modelId),
      messages,
      tools,
      stopWhen: stepCountIs(maxSteps),
      abortSignal,
      onAbort: ({ steps }) => {
        console.log(`Agent turn aborted after ${steps.length} step(s).`);
      },
    });

    return {
      textStream: result.textStream,
      text: result.text,
    };
  }

  async chatWithTools<TTools extends ToolSet>({
    messages,
    tools,
    maxSteps = 50,
  }: ChatWithToolsInput<TTools>): Promise<string> {
    const result = await generateText({
      model: this.gateway(this.modelId),
      messages,
      tools,
      stopWhen: stepCountIs(maxSteps),
    });

    return result.text.trim();
  }

  async generateStructured<TSchema extends z.ZodTypeAny>({
    messages,
    schema,
  }: GenerateStructuredInput<TSchema>): Promise<z.infer<TSchema>> {
    const result = await generateObject({
      model: this.gateway(this.modelId),
      messages,
      schema,
    });

    return result.object as z.infer<TSchema>;
  }
}
