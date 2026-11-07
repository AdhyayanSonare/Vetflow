import { createServer } from "node:http";
import { createApp } from "./app";
import { getConfig, type Config } from "./config/env";
import { getPool, closePool } from "./db/pool";
import { mountClient } from "./http/static";
import { logger } from "./logging/logger";
import { createAsrClient } from "./modules/voice/asr";
import { createExtractor } from "./modules/voice/extract";

/** Fails early, with a clear message, when the database is unreachable or has no Vetflow schema yet. */
async function checkDatabase(pool: ReturnType<typeof getPool>) {
  try {
    await pool.query("select 1");
  } catch (e) {
    throw new Error(`Cannot connect to the database: ${(e as Error).message}. Check DATABASE_URL (or ADMIN_DATABASE_URL and APP_DB_PASSWORD) in .env.`, { cause: e });
  }
  const r = await pool.query("select to_regclass('public.stock_ledger') as t");
  if (!r.rows[0].t) throw new Error("The database has no Vetflow tables. Run `pnpm db:migrate` first.");
}

/** Starts the web server. Returns a handle that stops it and closes the database pool. */
export async function startServer(config: Config = getConfig()) {
  const pool = getPool();
  await checkDatabase(pool);
  if (config.isProduction && !config.cookieSecure) {
    logger.warn("COOKIE_SECURE is off in production: sign-in cookies travel without HTTPS protection. Only acceptable for a local demo or behind a TLS proxy you control.");
  }
  if (!process.env.NODE_ENV) {
    logger.warn("NODE_ENV is not set, so this is running in development mode (no CSP header, insecure cookies). Set NODE_ENV=production for a real deployment.");
  }

  const app = createApp(pool, {
    production: config.isProduction,
    secureCookies: config.cookieSecure,
    relaxCsp: !config.isProduction,
    asr: createAsrClient(config),
    extractor: createExtractor(config.groq),
    sitePassword: config.sitePassword,
  });
  const server = createServer(app);

  // Unknown API paths are JSON 404s. Everything else is the single-page app.
  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found." } }));
  await mountClient(app, server, config.isProduction);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "0.0.0.0", () => resolve());
  });
  logger.info({
    port: config.port, env: config.nodeEnv, transcription: config.asr.kind, extraction: config.capabilities.extraction, sitePassword: !!config.sitePassword,
  }, `Vetflow listening on http://localhost:${config.port}`);

  return {
    url: `http://localhost:${config.port}`,
    stop: async () => {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await closePool();
    },
  };
}
