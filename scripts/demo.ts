import "dotenv/config";
import "./lib/quiet";
import { existsSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import pg from "pg";
import { build } from "vite";
import { migrate } from "../server/db/migrate";
import { DEMO_CLINIC, DEMO_PASSWORD, DEMO_USERS, seedDemo } from "../server/db/seed";
import { startEmbedded } from "./lib/embedded";

/**
 * One command demo: `pnpm demo`. Needs only Node and the installed packages.
 * Starts a real PostgreSQL (kept in .demo-data/), applies migrations, loads the synthetic demo clinic on
 * first run, builds the client if needed, and serves the app. Ctrl+C stops everything.
 *   pnpm demo           start (data is kept between runs)
 *   pnpm demo --reset   throw the demo data away and start fresh
 *   pnpm demo --rebuild rebuild the client
 * Environment: PORT (web, default 3000), DEMO_PG_PORT (database, default 54320), DEMO_DATA_DIR (default .demo-data).
 *
 * It never reads the hosted-database settings in .env, so it cannot touch another database.
 */
const args = new Set(process.argv.slice(2));
const root = process.cwd();
const dataRoot = path.resolve(root, process.env.DEMO_DATA_DIR || ".demo-data");
const httpPort = Number(process.env.PORT || 3000);
const pgPort = Number(process.env.DEMO_PG_PORT || 54320);

// The demo owns its database. Ignore anything pointing elsewhere.
for (const k of ["DATABASE_URL", "ADMIN_DATABASE_URL", "APP_DB_PASSWORD", "DATABASE_CA_CERT", "SITE_PASSWORD"]) delete process.env[k];

const free = (port: number) => new Promise<boolean>(resolve => {
  const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "127.0.0.1");
});
for (const [name, port] of [["the web server", httpPort], ["the demo database", pgPort]] as const) {
  if (!(await free(port))) {
    console.error(`Port ${port} is already in use, so ${name} cannot start. Stop whatever is using it, or choose another port, for example: PORT=3100 pnpm demo`);
    process.exit(1);
  }
}

if (args.has("--reset") && existsSync(dataRoot)) {
  rmSync(dataRoot, { recursive: true, force: true });
  console.log("Removed the old demo data.");
}

console.log("Starting the demo database (first run takes a few seconds)...");
const db = await startEmbedded({ dir: path.join(dataRoot, "pg"), port: pgPort, persistent: true, adminPassword: "demo_admin_pw", appPassword: "demo_app_pw" });
let stopping = false;
const shutdown = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping...");
  try { await server?.stop(); } catch { /* already stopped */ }
  try { await db.stop(); } catch { /* already stopped */ }
  process.exit(code);
};
let server: { url: string; stop: () => Promise<void> } | undefined;
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

try {
  await migrate({ adminUrl: db.adminUrl, appPassword: "demo_app_pw" });
  const probe = new pg.Client({ connectionString: db.adminUrl });
  await probe.connect();
  const empty = (await probe.query("select count(*)::int n from tenants")).rows[0].n === 0;
  await probe.end();
  if (empty && !args.has("--no-seed")) {
    console.log("Loading the demo clinic (synthetic data)...");
    await seedDemo({ adminUrl: db.adminUrl, appUrl: db.appUrl, log: m => console.log(" ", m) });
  }

  if (args.has("--rebuild") || !existsSync(path.join(root, "dist", "public", "index.html"))) {
    console.log("Building the app...");
    await build({ configFile: path.join(root, "vite.config.ts"), logLevel: "warn" });
  }

  // Serve the production build over plain HTTP: cookies must not be marked Secure on http://localhost.
  Object.assign(process.env, { DATABASE_URL: db.appUrl, NODE_ENV: "production", COOKIE_SECURE: "false", PORT: String(httpPort), LOG_LEVEL: process.env.LOG_LEVEL ?? "warn" });
  const { startServer } = await import("../server/start");
  server = await startServer();

  console.log(`\n  Vetflow demo is running at ${server.url}\n`);
  console.log(`  Clinic: ${DEMO_CLINIC}`);
  console.log(`  Password for every account: ${DEMO_PASSWORD}`);
  for (const u of DEMO_USERS) console.log(`    ${u.email.padEnd(28)} ${u.title}`);
  console.log("\n  Voice: " + (process.env.GROQ_API_KEY ? "transcription is on (Groq)." : "transcription is off (no GROQ_API_KEY in .env). Everything else works; type or paste a dictation to try the draft flow."));
  console.log("  Press Ctrl+C to stop.\n");
} catch (e) {
  console.error("\nThe demo could not start:", (e as Error).message);
  await shutdown(1);
}
