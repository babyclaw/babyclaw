import { createWriteStream } from "node:fs";
import pino from "pino";
import type { LoggingConfig } from "./config.js";
import { getDefaultLoggingConfig } from "./config.js";

let rootLogger: pino.Logger | null = null;

export function createLogger({ config }: { config?: Partial<LoggingConfig> }): pino.Logger {
  const resolved: LoggingConfig = {
    ...getDefaultLoggingConfig(),
    ...config,
  };

  const pinoOptions: pino.LoggerOptions = {
    level: resolved.level,
    timestamp: resolved.includeTimestamps
      ? () => `,"time":"${new Date().toISOString()}"`
      : false,
    base: resolved.includeHostname ? undefined : { pid: process.pid },
    redact: {
      paths: resolved.redact,
      censor: "[REDACTED]",
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  let destination: pino.DestinationStream;

  if (resolved.format === "pretty") {
    const prettyTransport = pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid",
        messageFormat: "{msg}",
        singleLine: false,
      },
    });
    destination = prettyTransport;
  } else if (resolved.output !== "stdout") {
    destination = createWriteStream(resolved.output, { flags: "a" });
  } else {
    destination = pino.destination({ sync: false });
  }

  const logger = pino(pinoOptions, destination);
  rootLogger = logger;
  return logger;
}

export function getLogger(): pino.Logger {
  if (!rootLogger) {
    rootLogger = createLogger({});
  }
  return rootLogger;
}

export function createChildLogger({
  context,
}: {
  context: Record<string, unknown>;
}): pino.Logger {
  return getLogger().child(context);
}

export type { Logger } from "pino";
