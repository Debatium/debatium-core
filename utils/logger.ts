import pino from "pino";
import type { AppConfig } from "../config.js";

export function createLogger(config: AppConfig): pino.Logger {
  const targets: pino.TransportTargetOptions[] = [];

  if (!config.isProd) {
    targets.push({
      target: "pino-pretty",
      options: { colorize: true },
      level: "debug",
    });
  } else {
    targets.push({
      target: "pino/file",
      options: { destination: 1 }, // stdout
      level: "info",
    });
  }

  if (config.logFilePath) {
    targets.push({
      target: "pino/file",
      options: { destination: config.logFilePath, mkdir: true },
      level: config.isProd ? "info" : "debug",
    });
  }

  return pino({
    level: config.isProd ? "info" : "debug",
    transport: { targets },
  });
}
