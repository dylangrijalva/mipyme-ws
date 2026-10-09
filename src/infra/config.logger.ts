import pino, { type Bindings, type ChildLoggerOptions, type Logger } from "pino";
import pretty from "pino-pretty";
import { snakeCaseKeys } from "../utils/snake-case-keys.ts";

const REDACTED_FIELDS = ["access_token", "refresh_token", "password"] as const;
const MAX_REDACTION_DEPTH = 4 as const;

function buildRedactionPrefixes(maxDepth: number): string[] {
  let currentDepthPrefixes = ["*"];
  const allPrefixes = [...currentDepthPrefixes];

  for (let depth = 2; depth <= maxDepth; depth++) {
    const nextDepthPrefixes = currentDepthPrefixes.flatMap((prefix) => [`${prefix}.*`, `${prefix}[*]`]);
    allPrefixes.push(...nextDepthPrefixes);
    currentDepthPrefixes = nextDepthPrefixes;
  }

  return allPrefixes;
}

const FIELDS_TO_REDACT = buildRedactionPrefixes(MAX_REDACTION_DEPTH).flatMap((prefix) =>
  REDACTED_FIELDS.map((field) => `${prefix}.${field}`),
);

type Config = {
  mode: "json" | "pretty";
};

function createLogger(config: Config): Logger {
  const baseConfig = {
    messageKey: "message",
    redact: { paths: FIELDS_TO_REDACT, censor: "***" },
  } as const;

  const logger =
    config.mode === "json"
      ? pino({
          ...baseConfig,
          formatters: {
            log(object: Record<string, unknown>) {
              return snakeCaseKeys(object);
            },
            level(label: string) {
              return { level: label.toUpperCase() };
            },
            bindings(bindings: Bindings) {
              const { pid, ...rest } = bindings;

              return snakeCaseKeys(rest);
            },
          },
          timestamp() {
            return `,"timestamp":"${new Date(Date.now()).toISOString()}"`;
          },
        })
      : pino({ ...baseConfig, base: null, level: "debug" }, pretty({ colorize: true }));

  if (config.mode === "json") {
    const createChild = logger.child;
    logger.child = function <ChildCustomLevels extends string = never>(
      bindings: Bindings,
      options?: ChildLoggerOptions<ChildCustomLevels>,
    ): Logger<ChildCustomLevels> {
      return createChild.call(this, snakeCaseKeys(bindings), options) as Logger<ChildCustomLevels>;
    };
  }

  return logger;
}

function noopLogger(): Logger {
  return pino({ enabled: false });
}

export { createLogger, noopLogger };
