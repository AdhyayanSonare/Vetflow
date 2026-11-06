import "dotenv/config";
import "./lib/quiet";
import pg from "pg";
import { parseArgs } from "node:util";
import { getConfig } from "../server/config/env";
import { poolConfig } from "../server/config/database";
import { resetUserPassword } from "../server/db/bootstrap";

/**
 * For a locked-out admin. Sets a new password for one user, clears the lock and ends their sessions.
 *   pnpm user:set-password --email owner@greenfield.example
 * A random password is printed once. Needs the database owner connection (ADMIN_DATABASE_URL).
 */
const { values } = parseArgs({ options: { email: { type: "string" }, password: { type: "string" } } });
if (!values.email) {
  console.error("Usage: pnpm user:set-password --email someone@example.com [--password ...]");
  process.exit(2);
}
const config = getConfig();
if (!config.adminDatabaseUrl) {
  console.error("Set ADMIN_DATABASE_URL in .env first (the owner connection, not the app role). See .env.example.");
  process.exit(2);
}
const admin = new pg.Pool({ ...poolConfig(config.adminDatabaseUrl, config.databaseCaCert), max: 2 });
try {
  const r = await resetUserPassword(admin, values.email, values.password);
  console.log(`\nNew password set for ${r.email}. Their old sessions are signed out and any lock is cleared.`);
  console.log(r.generatedPassword ? `  Password: ${r.password}   (shown once; change it after signing in)` : "  Password: the one you supplied");
  if (!r.active) console.log("  Note: this account is deactivated. An admin must reactivate it under Settings, Users before it can sign in.");
} catch (e) {
  console.error("Could not set the password:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await admin.end();
}
