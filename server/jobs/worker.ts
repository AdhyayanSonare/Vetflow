import "dotenv/config";
import { PgBoss } from "pg-boss";
import type pg from "pg";
import { poolConfig } from "../config/database";
import { getConfig } from "../config/env";
import { getPool } from "../db/pool";
import { logger as defaultLogger, type Logger } from "../logging/logger";
import { runNightly, type JobResult } from "./nightly";

export const NIGHTLY_QUEUE = "vetflow-nightly";

export type WorkerOptions = {
  /** Owner connection. pg-boss keeps its queue tables in its own schema, so it needs more than the app role. */
  adminUrl: string;
  caCert?: string;
  /** App-role pool used for the checks themselves, so row-level security applies. */
  pool: pg.Pool;
  /** Cron expression, evaluated in Indian time. Default: 02:30 every night. */
  cron?: string;
  logger?: Logger;
  onRun?: (result: JobResult) => void;
};

/**
 * Starts the job runner. Every night it recomputes balances from the ledger and alerts on any
 * difference, raises expiry and low-stock alerts, and purges transcripts past each tenant's retention.
 */
export async function startWorker(opts: WorkerOptions) {
  const log = opts.logger ?? defaultLogger;
  const cfg = poolConfig(opts.adminUrl, opts.caCert);
  const boss = new PgBoss({ connectionString: cfg.connectionString, ssl: cfg.ssl as never });
  boss.on("error", (err: Error) => log.error({ err: err.message }, "job runner error"));
  await boss.start();
  await boss.createQueue(NIGHTLY_QUEUE);
  await boss.schedule(NIGHTLY_QUEUE, opts.cron ?? "30 2 * * *", null, { tz: "Asia/Kolkata" });
  await boss.work(NIGHTLY_QUEUE, async () => {
    const result = await runNightly(opts.pool);
    log.info(result, "nightly checks finished");
    opts.onRun?.(result);
    return result;
  });
  log.info({ cron: opts.cron ?? "30 2 * * *" }, "worker started");
  return { boss, runNow: () => boss.send(NIGHTLY_QUEUE, {}), stop: () => boss.stop({ graceful: true, timeout: 10_000 }) };
}

// Run directly: `pnpm worker`
if (process.argv[1] && /worker\.(ts|js)$/.test(process.argv[1])) {
  const config = getConfig();
  if (!config.adminDatabaseUrl) {
    defaultLogger.fatal("The worker needs ADMIN_DATABASE_URL in .env (the owner connection). See .env.example.");
    process.exit(1);
  }
  startWorker({ adminUrl: config.adminDatabaseUrl, caCert: config.databaseCaCert, pool: getPool() })
    .then(w => {
      const stop = () => w.stop().finally(() => process.exit(0));
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
    })
    .catch(err => { defaultLogger.fatal({ err: err.message }, "worker failed to start"); process.exit(1); });
}
