import pino from "pino";

/**
 * Structured logger. Secrets, cookies and credentials are redacted, and request bodies are never
 * logged, so patient details and audio never reach the logs.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: [
      "req.headers.cookie", "req.headers.authorization", "headers.cookie", "headers.authorization",
      "password", "*.password", "token", "*.token", "apiKey", "*.apiKey", "databaseUrl", "*.databaseUrl",
    ],
    censor: "[redacted]",
  },
  base: { app: "vetflow" },
});

export type Logger = typeof logger;
