import "dotenv/config";
import pg from "pg";
import { poolConfig } from "../server/config/database";
import { getConfig } from "../server/config/env";
import { migrate } from "../server/db/migrate";

/** Applies pending migrations as the owner role and sets the app role's password. Safe to run again. */
const config = getConfig();
if (!config.adminDatabaseUrl) {
  console.error("Set ADMIN_DATABASE_URL in .env first (the owner connection). See .env.example.");
  process.exit(2);
}

// A database that already has the tables but no migration history needs `pnpm db:baseline`, not a re-run.
const probe = new pg.Client(poolConfig(config.adminDatabaseUrl, config.databaseCaCert));
await probe.connect();
const state = (await probe.query("select to_regclass('public.schema_migrations') as hist, to_regclass('public.tenants') as app")).rows[0];
await probe.end();
if (!state.hist && state.app) {
  console.error("This database already has Vetflow tables but no migration history.\nRun `pnpm db:baseline` to verify the schema and record it, then run this again.");
  process.exit(1);
}

const applied = await migrate({ adminUrl: config.adminDatabaseUrl, appPassword: config.appDbPassword, caCert: config.databaseCaCert });
console.log(applied.length ? `Applied ${applied.length} migration(s): ${applied.join(", ")}` : "Database is up to date.");
if (!config.appDbPassword) console.log("Note: APP_DB_PASSWORD is not set, so the vetflow_app role password was left as it is.");
