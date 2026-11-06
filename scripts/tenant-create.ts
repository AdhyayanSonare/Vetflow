import "dotenv/config";
import "./lib/quiet";
import pg from "pg";
import { parseArgs } from "node:util";
import { getConfig } from "../server/config/env";
import { poolConfig } from "../server/config/database";
import { createClinic } from "../server/db/bootstrap";

/**
 * Creates a real clinic and its first admin account in the database named by ADMIN_DATABASE_URL.
 *   pnpm tenant:create --clinic "Greenfield Veterinary" --admin-email owner@greenfield.example --admin-name "Asha Rao"
 * A random password is printed once. Sign in, then change it under Settings > Users.
 */
const { values } = parseArgs({
  options: {
    clinic: { type: "string" },
    branch: { type: "string" },
    "admin-email": { type: "string" },
    "admin-name": { type: "string" },
    password: { type: "string" },
  },
});

if (!values.clinic || !values["admin-email"] || !values["admin-name"]) {
  console.error('Usage: pnpm tenant:create --clinic "Clinic name" --admin-email owner@example.com --admin-name "Full name" [--branch "Main branch"] [--password ...]');
  process.exit(2);
}
const config = getConfig();
if (!config.adminDatabaseUrl) {
  console.error("Set ADMIN_DATABASE_URL in .env first (the owner connection, not the app role). See .env.example.");
  process.exit(2);
}

const admin = new pg.Pool({ ...poolConfig(config.adminDatabaseUrl, config.databaseCaCert), max: 2 });
try {
  const r = await createClinic(admin, {
    clinicName: values.clinic,
    branchName: values.branch,
    adminEmail: values["admin-email"],
    adminName: values["admin-name"],
    password: values.password,
  });
  console.log(`\nCreated "${values.clinic}" with one branch and one admin.`);
  console.log(`  Email:    ${r.adminEmail}`);
  console.log(r.generatedPassword ? `  Password: ${r.password}   (shown once; change it after signing in)` : "  Password: the one you supplied");
} catch (e) {
  console.error("Could not create the clinic:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await admin.end();
}
