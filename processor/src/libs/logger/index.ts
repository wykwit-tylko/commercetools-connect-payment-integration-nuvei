import { getRequestContext } from "../fastify/context/context.js";
import { config } from "../../config/config.js";

type LogMethod = (message: string, meta?: unknown) => void;

type ApplicationLogger = {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
};

const levels = ["debug", "info", "warn", "error"] as const;

function shouldLog(level: (typeof levels)[number]): boolean {
  const configuredLevelIndex = levels.indexOf(config.loggerLevel as (typeof levels)[number]);
  const levelIndex = levels.indexOf(level);
  return (
    levelIndex >= (configuredLevelIndex === -1 ? levels.indexOf("info") : configuredLevelIndex)
  );
}

function write(level: (typeof levels)[number], message: string, meta?: unknown): void {
  if (!shouldLog(level)) {
    return;
  }

  const context = getRequestContext();
  const entry = {
    level,
    message,
    projectKey: config.projectKey,
    version: process.env.npm_package_version,
    name: process.env.npm_package_name,
    correlationId: context.correlationId,
    pathTemplate: context.pathTemplate,
    path: context.path,
    ...(meta === undefined ? {} : { meta }),
  };

  const output = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(`${output}\n`);
    return;
  }
  process.stdout.write(`${output}\n`);
}

export const log: ApplicationLogger = {
  debug: (message, meta) => write("debug", message, meta),
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
