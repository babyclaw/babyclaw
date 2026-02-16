export const MAX_TOOL_PAYLOAD_BYTES = 256 * 1024;

export function ensurePayloadWithinLimit({
  value,
  maxBytes = MAX_TOOL_PAYLOAD_BYTES,
}: {
  value: string;
  maxBytes?: number;
}): void {
  const size = Buffer.byteLength(value, "utf8");
  if (size > maxBytes) {
    throw new Error(`Payload exceeds ${maxBytes} bytes`);
  }
}

export function ensureJsonWithinLimit({
  value,
  maxBytes = MAX_TOOL_PAYLOAD_BYTES,
}: {
  value: unknown;
  maxBytes?: number;
}): void {
  ensurePayloadWithinLimit({
    value: JSON.stringify(value),
    maxBytes,
  });
}
