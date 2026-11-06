import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type EmbeddedDb = {
  adminUrl: string;
  appUrl: string;
  /** True when this call created the cluster from scratch. */
  fresh: boolean;
  stop: () => Promise<void>;
};

/**
 * A real PostgreSQL that needs no installation: binaries come from the embedded-postgres package,
 * one per operating system. Used by the demo, and to build a reference schema for comparisons.
 */
export async function startEmbedded(opts: { dir?: string; port: number; persistent: boolean; adminPassword?: string; appPassword?: string }): Promise<EmbeddedDb> {
  const adminPassword = opts.adminPassword ?? "local_admin_pw";
  const appPassword = opts.appPassword ?? "local_app_pw";
  const dir = opts.dir ?? mkdtempSync(path.join(os.tmpdir(), "vetflow-pg-"));
  const fresh = !existsSync(path.join(dir, "PG_VERSION"));
  if (fresh) mkdirSync(dir, { recursive: true });
  const pgServer = new EmbeddedPostgres({
    databaseDir: dir, user: "postgres", password: adminPassword, port: opts.port, persistent: opts.persistent,
    onLog: () => {}, onError: () => {},
  });
  if (fresh) await pgServer.initialise();
  await pgServer.start();
  return {
    adminUrl: `postgres://postgres:${adminPassword}@localhost:${opts.port}/postgres`,
    appUrl: `postgres://vetflow_app:${appPassword}@localhost:${opts.port}/postgres`,
    fresh,
    stop: async () => {
      await pgServer.stop();
      if (!opts.persistent) rmSync(dir, { recursive: true, force: true });
    },
  };
}
