import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app";
import { getConfig } from "./config/env";
import { getPool } from "./db/pool";
import { mountClient } from "./http/static";
import { logger } from "./logging/logger";
import { createAsrClient } from "./modules/voice/asr";
import { createExtractor } from "./modules/voice/extract";

/** Fails early, with a clear message, when the database is unreachable or has no Vetflow schema yet. */
async function checkDatabase(pool: ReturnType<typeof getPool>) {
  try {
    await pool.query("select 1");
  } catch (e) {
    throw new Error(`Cannot connect to the database: ${(e as Error).message}. Check DATABASE_URL (or ADMIN_DATABASE_URL and APP_DB_PASSWORD) in .env.`);
  }
  const r = await pool.query("select to_regclass('public.stock_ledger') as t");
  if (!r.rows[0].t) throw new Error("The database has no Vetflow tables. Run `pnpm db:migrate` first.");
}

async function main() {
  const config = getConfig();
  const pool = getPool();
  await checkDatabase(pool);

  const app = createApp(pool, {
    production: config.isProduction,
    relaxCsp: !config.isProduction,
    asr: createAsrClient(config),
    extractor: createExtractor(config.groq),
    sitePassword: config.sitePassword,
  });
  const server = createServer(app);

  // Unknown API paths are JSON 404s. Everything else is the single-page app.
  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found." } }));
  await mountClient(app, server, config.isProduction);

  server.on("error", err => { logger.fatal({ err: err.message }, "server failed"); process.exit(1); });
  server.listen(config.port, "0.0.0.0", () => {
    logger.info({
      port: config.port, env: config.nodeEnv, transcription: config.asr.kind, extraction: config.capabilities.extraction, sitePassword: !!config.sitePassword,
    }, `Vetflow listening on http://localhost:${config.port}`);
  });

  const stop = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch(err => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, "startup failed");
  process.exit(1);
});
