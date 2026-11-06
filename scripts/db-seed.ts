import "dotenv/config";
import "./lib/quiet";
import { getConfig } from "../server/config/env";
import { DEMO_CLINIC, DEMO_PASSWORD, DEMO_USERS, seedDemo } from "../server/db/seed";

/** Loads the synthetic demo clinic into an EMPTY database. It refuses to run if a tenant already exists. */
const config = getConfig();
if (!config.adminDatabaseUrl || !config.databaseUrl) {
  console.error("Set ADMIN_DATABASE_URL and APP_DB_PASSWORD (or DATABASE_URL) in .env first. See .env.example.");
  process.exit(2);
}
try {
  const r = await seedDemo({ adminUrl: config.adminDatabaseUrl, appUrl: config.databaseUrl, caCert: config.databaseCaCert, log: m => console.log(" ", m) });
  console.log(`\nSeeded "${DEMO_CLINIC}": ${r.items} items, ${r.users} users.\nSign in with any of these accounts (password: ${DEMO_PASSWORD}):`);
  for (const u of DEMO_USERS) console.log(`  ${u.email.padEnd(28)} ${u.title}`);
} catch (e) {
  console.error("Seed failed:", (e as Error).message);
  process.exit(1);
}
