import type { ToolExecutionContext } from "../utils/tool-context.js";

export type ToolErrorPayload = {
  code: string;
  message: string;
  retryable: boolean;
  hint?: string;
};

export type ToolFailureResult = {
  ok: false;
  error: ToolErrorPayload;
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

export function toolFailure({
  code,
  message,
  retryable = false,
  hint,
}: {
  code: string;
  message: string;
  retryable?: boolean;
  hint?: string;
}): ToolFailureResult {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(hint ? { hint } : {}),
    },
  };
}

export async function withToolLogging<TSuccess extends object>({
  context,
  toolName,
  action,
  defaultCode = "TOOL_EXECUTION_FAILED",
}: {
  context: ToolExecutionContext;
  toolName: string;
  action: () => Promise<TSuccess>;
  defaultCode?: string;
}): Promise<TSuccess | ToolFailureResult> {
  console.log(`[tool:${toolName}] source=${context.runSource} start`);

  try {
    const result = await action();
    console.log(`[tool:${toolName}] source=${context.runSource} success`);
    return result;
  } catch (error) {
    const payload = toToolErrorPayload({
      error,
      defaultCode,
    });
    console.error(
      `[tool:${toolName}] source=${context.runSource} error code=${payload.code} message=${payload.message}`,
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
