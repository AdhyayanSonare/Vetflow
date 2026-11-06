import EmbeddedPostgres from "embedded-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate } from "../server/db/migrate";

const PORT = 54330;
const APP_PASSWORD = "app_test_pw";

/** Starts a real PostgreSQL for the DB test project, applies migrations, then tears it down. */
export default async function setup() {
  // Allow a CI-provided database instead of the embedded one.
  if (process.env.TEST_ADMIN_URL) {
    await migrate({ adminUrl: process.env.TEST_ADMIN_URL, appPassword: APP_PASSWORD });
    return;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "vetflow-pg-"));
  const pgServer = new EmbeddedPostgres({
    databaseDir: dir, user: "postgres", password: "admin_pw", port: PORT, persistent: false,
  });
  await pgServer.initialise();
  await pgServer.start();
  const adminUrl = `postgres://postgres:admin_pw@localhost:${PORT}/postgres`;
  await migrate({ adminUrl, appPassword: APP_PASSWORD });
  process.env.TEST_ADMIN_URL = adminUrl;
  process.env.TEST_APP_URL = `postgres://vetflow_app:${APP_PASSWORD}@localhost:${PORT}/postgres`;
  return async () => {
    await pgServer.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
