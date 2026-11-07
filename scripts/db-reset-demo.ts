import "dotenv/config";
import "./lib/quiet";
import { getConfig } from "../server/config/env";
import { resetDemoData } from "../server/db/seed";

/**
 * Clears a database that holds ONLY the labelled demo clinic, so `pnpm db:seed` can load it again.
 * Refuses if any other clinic exists. Needs --yes-delete-demo-data, and --allow-remote for a hosted database.
 */
const config = getConfig();
if (!config.adminDatabaseUrl) {
  console.error("Set ADMIN_DATABASE_URL in .env first. See .env.example.");
  process.exit(2);
}
if (!process.argv.includes("--yes-delete-demo-data")) {
  console.error("This deletes the demo clinic and everything in it. Run again with --yes-delete-demo-data to confirm.");
  process.exit(2);
}
const host = new URL(config.adminDatabaseUrl).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !process.argv.includes("--allow-remote")) {
  console.error(`${host} is not a local database. Add --allow-remote if you really mean to clear the hosted demo.`);
  process.exit(2);
}
try {
  const r = await resetDemoData({ adminUrl: config.adminDatabaseUrl, caCert: config.databaseCaCert });
  console.log(`Cleared ${r.removedTenants} demo clinic(s). Now run: pnpm db:seed${["localhost", "127.0.0.1"].includes(host) ? "" : " --allow-remote"}`);
} catch (e) {
  console.error("Reset failed:", (e as Error).message);
  process.exit(1);
}
