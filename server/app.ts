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
  /** Marks the session cookie Secure and sends HSTS. Defaults to production. Switch off for plain-HTTP local use. */
  secureCookies?: boolean;
  production?: boolean;
  /** Relax the content security policy for the Vite dev server only. */
  relaxCsp?: boolean;
  /** Speech to text provider. Null means transcription is not set up. */
  asr?: AsrClient | null;
  /** Note extraction provider. Null means extraction is not set up. */
  extractor?: Extractor | null;
  /** When set, the whole site sits behind this shared password. */
  sitePassword?: string;
  /** Public demo: no site password; the sign-in page lists the demo accounts. */
  demoMode?: boolean;
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
  const secure = opts.secureCookies ?? !!opts.production;
  app.use(securityHeaders({ production: secure, relaxCsp: opts.relaxCsp }));
  app.use(sitePassword(() => (opts.demoMode ? undefined : opts.sitePassword)));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    try { await pool.query("select 1"); res.json({ status: "ok" }); }
    catch { res.status(503).json({ status: "database_unavailable" }); }
  });

  app.use("/api", attachSession(pool));
  registerAuthRoutes(app, pool, {
    production: secure,
    demoMode: !!opts.demoMode,
    // No mail server is wired up yet, so by default nothing delivers a token. Tests set app.locals.onResetToken.
    resetDelivery: () => app.locals.onResetToken as ((email: string, token: string) => void) | undefined,
  });
  registerModules(app, pool, { voice: { asr: opts.asr ?? null, extractor: opts.extractor ?? null } });

  app.use("/api", apiErrorHandler(log));
  return app;
}
