const SENSITIVE_PATTERNS = [
  /^(sk|pk|api|token|key|secret|bearer|auth)[-_][\w-]{8,}/i,
  /^ghp_[\w]{36,}$/,
  /^xoxb-[\w-]+$/,
  /^bot\d+:[A-Za-z0-9_-]{35,}$/,
  /^[\w-]{20,}\.[\w-]{6,}\.[\w-]{20,}$/,
];

const REDACTED = "[REDACTED]";

export function redactValue({ value }: { value: unknown }): unknown {
  if (typeof value === "string") {
    return looksLikeSecret({ value }) ? REDACTED : value;
  }
  return value;
}

export function redactObject({ obj }: { obj: Record<string, unknown> }): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey({ key })) {
      result[key] = REDACTED;
    } else if (typeof value === "string" && looksLikeSecret({ value })) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = redactObject({ obj: value as Record<string, unknown> });
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactToolInput({
  input,
}: {
  input: Record<string, unknown>;
}): Record<string, unknown> {
  return redactObject({ obj: input });
}

export function truncateOutput({
  output,
  maxLength = 500,
}: {
  output: string;
  maxLength?: number;
}): string {
  if (output.length <= maxLength) {
    return output;
  }
  return output.slice(0, maxLength) + `... [truncated ${output.length - maxLength} chars]`;
}

function isSensitiveKey({ key }: { key: string }): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes("apikey") ||
    lower.includes("api_key") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("token") ||
    lower.includes("authorization") ||
    lower.includes("cookie") ||
    lower.includes("credential")
  );
}

function looksLikeSecret({ value }: { value: string }): boolean {
  if (value.length < 16) {
    return false;
  }
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}
