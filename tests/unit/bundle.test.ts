import { build } from "esbuild";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serverBuildOptions } from "../../scripts/build-server";
import { adminUrl, appUrl } from "../helpers";

/**
 * Builds the server the way `pnpm build` does, lays it out like the Docker image
 * (<root>/dist and <root>/db), and runs the real commands against an empty database:
 * migrate, create a clinic, start the server, sign in. This is what production executes.
 */
const repo = path.resolve(import.meta.dirname, "../..");
// Inside the repo so the bundles can resolve node_modules, like the image's /app/node_modules.
const root = path.join(repo, "node_modules", ".cache", `bundle-test-${process.pid}`);
const dist = path.join(root, "dist");
const dbName = `bundle_${process.pid}_${Date.now().toString(36)}`;
const appPassword = decodeURIComponent(new URL(appUrl()).password);
const withDb = (url: string) => { const u = new URL(url); u.pathname = `/${dbName}`; return u.toString(); };
const ADMIN = () => withDb(adminUrl());

let admin: pg.Pool;
let server: ChildProcess | undefined;
let port = 0;
let serverLog = "";

/** The environment a container would have: nothing from the developer's shell or .env. */
function envFor(extra: Record<string, string>) {
  const clean = { ...process.env };
  for (const k of ["DATABASE_URL", "ADMIN_DATABASE_URL", "APP_DB_PASSWORD", "GROQ_API_KEY", "ASR_URL", "SITE_PASSWORD", "COOKIE_SECURE", "NODE_ENV", "PORT", "DATABASE_CA_CERT"]) delete clean[k];
  return { ...clean, ...extra };
}
const run = (file: string, args: string[], extra: Record<string, string> = {}) =>
  execFileSync(process.execPath, [path.join(dist, file), ...args], {
    cwd: path.resolve(root, ".."), // not the repo root, so nothing is found by accident
    env: envFor({ ADMIN_DATABASE_URL: ADMIN(), APP_DB_PASSWORD: appPassword, ...extra }),
    encoding: "utf8",
    timeout: 120_000,
  });
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: adminUrl(), max: 2 });
  await admin.query(`create database ${dbName}`);
  mkdirSync(path.join(dist, "public"), { recursive: true });
  writeFileSync(path.join(dist, "public", "index.html"), "<!doctype html><title>stub client</title>");
  cpSync(path.join(repo, "db", "migrations"), path.join(root, "db", "migrations"), { recursive: true });
  await build({ ...serverBuildOptions(dist), logLevel: "silent" });
}, 120_000);

afterAll(async () => {
  server?.kill();
  await new Promise(r => setTimeout(r, 300));
  await admin?.query(`drop database if exists ${dbName} with (force)`).catch(() => {});
  await admin?.end();
  rmSync(root, { recursive: true, force: true });
}, 60_000);

describe("the production bundle", () => {
  it("is written as flat files, which is what the Dockerfile, Compose file and `pnpm start` run", () => {
    for (const f of ["index.js", "worker.js", "db-migrate.js", "tenant-create.js"]) expect(existsSync(path.join(dist, f)), f).toBe(true);
    expect(existsSync(path.join(dist, "server"))).toBe(false);
  });

  it("migrates an empty database from its own folder layout, and is safe to run again", () => {
    expect(run("db-migrate.js", [])).toMatch(/Applied \d+ migration/);
    expect(run("db-migrate.js", [])).toMatch(/up to date/);
  });

  it("creates a clinic and its first admin", () => {
    const out = run("tenant-create.js", ["--clinic", "Bundle Clinic", "--admin-email", "bundle@example.test", "--admin-name", "Bundle Admin"]);
    const password = /Password:\s+(\S+)/.exec(out)?.[1];
    expect(password).toBeTruthy();
    process.env.BUNDLE_TEST_PASSWORD = password;
  });

  it("serves the app, the single-page fallback, and a working sign-in", async () => {
    port = await freePort();
    server = spawn(process.execPath, [path.join(dist, "index.js")], {
      cwd: path.resolve(root, ".."),
      env: envFor({ NODE_ENV: "production", PORT: String(port), ADMIN_DATABASE_URL: ADMIN(), APP_DB_PASSWORD: appPassword, COOKIE_SECURE: "false", LOG_LEVEL: "warn" }),
    });
    server.stdout?.on("data", d => { serverLog += d; });
    server.stderr?.on("data", d => { serverLog += d; });
    const base = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let i = 0; i < 80 && !healthy; i++) {
      if (server.exitCode !== null) break;
      healthy = await fetch(`${base}/api/health`).then(r => r.ok, () => false);
      if (!healthy) await new Promise(r => setTimeout(r, 250));
    }
    expect(healthy, serverLog).toBe(true);

    expect(await (await fetch(`${base}/`)).text()).toContain("stub client");
    const deep = await fetch(`${base}/patients`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain("stub client");
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bundle@example.test", password: process.env.BUNDLE_TEST_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    const branches = (await (await fetch(`${base}/api/branches`, { headers: { cookie } })).json()) as Array<{ name: string }>;
    expect(branches.map(b => b.name)).toEqual(["Main branch"]);
  }, 60_000);
});
