import cookieParser from "cookie-parser";
import express from "express";
import type pg from "pg";
import { apiErrorHandler, attachSession, requestLogger, securityHeaders, sitePassword } from "./http/middleware";
import { logger as defaultLogger, type Logger } from "./logging/logger";
import { registerModules } from "./modules";
import { registerAuthRoutes } from "./modules/auth/routes";
import type { AsrClient } from "./modules/voice/asr";
import type { Extractor } from "./modules/voice/extract";

export type AppOptions = {
  production?: boolean;
  /** Relax the content security policy for the Vite dev server only. */
  relaxCsp?: boolean;
  /** Speech to text provider. Null means transcription is not set up. */
  asr?: AsrClient | null;
  /** Note extraction provider. Null means extraction is not set up. */
  extractor?: Extractor | null;
  /** When set, the whole site sits behind this shared password. */
  sitePassword?: string;
  logger?: Logger;
};

/**
 * Builds the Express app. It has no global state: the database pool and every provider are passed in,
 * so tests and the server entry assemble it the same way.
 */
export function createApp(pool: pg.Pool, opts: AppOptions = {}) {
  const log = opts.logger ?? defaultLogger;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.locals.capabilities = { transcription: !!opts.asr, extraction: !!opts.extractor };

  app.use(requestLogger(log));
  app.use(securityHeaders(opts));
  app.use(sitePassword(() => opts.sitePassword));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    try { await pool.query("select 1"); res.json({ status: "ok" }); }
    catch { res.status(503).json({ status: "database_unavailable" }); }
  });

  app.use("/api", attachSession(pool));
  registerAuthRoutes(app, pool, {
    production: opts.production,
    onResetToken: (email, token) => {
      // No mail server is wired up. Tests hook this; in development the token is logged so the flow can be tried.
      (app.locals.onResetToken as ((e: string, t: string) => void) | undefined)?.(email, token);
      if (!opts.production) log.info({ email, token }, "password reset token (development only)");
    },
  });
  registerModules(app, pool, { voice: { asr: opts.asr ?? null, extractor: opts.extractor ?? null } });

  app.use("/api", apiErrorHandler(log));
  return app;
}
