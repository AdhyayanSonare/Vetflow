import "dotenv/config";
import "./lib/quiet";
import { getConfig } from "../server/config/env";
import { DEMO_CLINIC, DEMO_PASSWORD, DEMO_USERS, resetDemoData, seedDemo } from "../server/db/seed";

/**
 * One command: clears a database that holds only the demo clinic, then loads it again.
 * Refuses if any other clinic exists. Add --allow-remote for a hosted database.
 */
const config = getConfig();
if (!config.adminDatabaseUrl || !config.databaseUrl) {
  console.error("Set ADMIN_DATABASE_URL and APP_DB_PASSWORD in .env first. See .env.example.");
  process.exit(2);
}
const host = new URL(config.adminDatabaseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !process.argv.includes("--allow-remote")) {
  console.error(`${host} is not a local database. Add --allow-remote if you really mean to reload the hosted demo.`);
  process.exit(2);
}
try {
  const cleared = await resetDemoData({ adminUrl: config.adminDatabaseUrl, caCert: config.databaseCaCert });
  console.log(`Cleared ${cleared.removedTenants} existing demo clinic(s). Loading the full demo (a few minutes on a hosted database)...`);
  const r = await seedDemo({ adminUrl: config.adminDatabaseUrl, appUrl: config.databaseUrl, caCert: config.databaseCaCert, log: m => console.log(" ", m) });
  console.log(`
Loaded "${DEMO_CLINIC}": ${r.items} items, ${r.users} users. Sign-in emails (the shared password is in shared/demo.ts, ${DEMO_PASSWORD.length} characters):`);
  for (const u of DEMO_USERS) console.log(`  ${u.email.padEnd(28)} ${u.title}`);
} catch (e) {
  console.error("Reload failed:", (e as Error).message);
  process.exit(1);
}
