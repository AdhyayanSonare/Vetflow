import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The project folder. The bundled PostgreSQL lives about 170 characters below it. */
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
/** Windows programs, including PostgreSQL, fail on paths near 260 characters. */
const WINDOWS_SAFE_ROOT_LENGTH = 90;

/** Plain-language advice when the project sits too deep in the folder tree for Windows, otherwise null. */
export function longPathAdvice(root: string = PROJECT_ROOT, platform: string = process.platform): string | null {
  if (platform !== "win32" || root.length <= WINDOWS_SAFE_ROOT_LENGTH) return null;
  return `The project folder path is ${root.length} characters long (${root}). Windows programs, including the bundled PostgreSQL, fail on paths near 260 characters. ` +
    "Move the project to a shorter folder such as C:\\Vetflow, run `pnpm install` again, and start it from there.";
}

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
  try {
    if (fresh) await pgServer.initialise();
    await pgServer.start();
  } catch (e) {
    const advice = longPathAdvice();
    if (advice) throw new Error(`The demo database could not start. ${advice}`, { cause: e });
    throw e;
  }
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
