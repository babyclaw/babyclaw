import { getLogger } from "../logging/index.js";
import { redactToolInput, truncateForLog } from "../logging/redact.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";

type ToolErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
  hint?: string;
};

export class ToolExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly hint?: string;

  constructor({
    code,
    message,
    retryable,
    hint,
  }: {
    code: string;
    message: string;
    retryable?: boolean;
    hint?: string;
  }) {
    super(message);
    this.code = code;
    this.retryable = retryable ?? false;
    this.hint = hint;
  }
}

let callIdCounter = 0;

export async function withToolLogging<TSuccess extends object>({
  context,
  toolName,
  action,
  defaultCode = "TOOL_EXECUTION_FAILED",
  input,
}: {
  context: ToolExecutionContext;
  toolName: string;
  action: () => Promise<TSuccess>;
  defaultCode?: string;
  input?: Record<string, unknown>;
}): Promise<TSuccess | { ok: false; error: ToolErrorPayload }> {
  const log = getLogger();
  const callId = `tool-${++callIdCounter}`;
  const startedAt = Date.now();

  const toolLog = log.child({
    component: "tool",
    toolName,
    callId,
    runSource: context.runSource,
    chatId: context.chatId,
  });

  toolLog.info(
    (input ? { input: redactToolInput({ input }) } : {}),
    `Tool call started: ${toolName}`,
  );

  try {
    const result = await action();
    const durationMs = Date.now() - startedAt;

    toolLog.info(
      { durationMs, success: true },
      `Tool call completed: ${toolName}`,
    );

    if (toolLog.isLevelEnabled("debug")) {
      const resultStr = JSON.stringify(result);
      toolLog.debug(
        { output: truncateForLog({ output: resultStr, maxLength: 300 }) },
        `Tool result: ${toolName}`,
      );
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const payload = toToolErrorPayload({
      error,
      defaultCode,
    });

    toolLog.error(
      { durationMs, errorCode: payload.code, errorMessage: payload.message },
      `Tool call failed: ${toolName}`,
    );

    return {
      ok: false,
      error: payload,
    };
  }
}

export function toToolErrorPayload({
  error,
  defaultCode = "TOOL_EXECUTION_FAILED",
}: {
  error: unknown;
  defaultCode?: string;
}): ToolErrorPayload {
  if (error instanceof ToolExecutionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.hint ? { hint: error.hint } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      code: defaultCode,
      message: error.message,
      retryable: false,
    };
  }

  return {
    code: defaultCode,
    message: String(error),
    retryable: false,
  };
}
