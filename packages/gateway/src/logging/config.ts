export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_FORMATS = ["json", "pretty"] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

export type LoggingConfig = {
  level: LogLevel;
  format: LogFormat;
  output: string;
  redact: string[];
  includeTimestamps: boolean;
  includeHostname: boolean;
};

const DEFAULT_REDACT_PATHS = [
  "apiKey",
  "botToken",
  "braveApiKey",
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "*.apiKey",
  "*.botToken",
  "*.token",
  "*.secret",
  "*.password",
  "config.ai.providers.*.apiKey",
  "config.channels.telegram.botToken",
  "config.tools.webSearch.braveApiKey",
];

export function getDefaultLoggingConfig(): LoggingConfig {
  const isDev = process.env.NODE_ENV !== "production";

  return {
    level: "info",
    format: isDev ? "pretty" : "json",
    output: "stdout",
    redact: [...DEFAULT_REDACT_PATHS],
    includeTimestamps: true,
    includeHostname: false,
  };
}
