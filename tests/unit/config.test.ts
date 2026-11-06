import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { poolConfig } from "../../server/config/database";
import { deriveAppDatabaseUrl, loadConfig } from "../../server/config/env";

describe("configuration", () => {
  it("loads defaults and reports what the server can do", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ nodeEnv: "development", port: 3000, isProduction: false });
    expect(c.asr.kind).toBe("none");
    expect(c.capabilities).toEqual({ transcription: false, extraction: false });
  });

  it("picks Groq when a key is set, the local service when only ASR_URL is set", () => {
    expect(loadConfig({ GROQ_API_KEY: "k" }).asr.kind).toBe("groq");
    expect(loadConfig({ GROQ_API_KEY: "k" }).capabilities).toEqual({ transcription: true, extraction: true });
    const local = loadConfig({ ASR_URL: "http://asr:8000" });
    expect(local.asr).toEqual({ kind: "local", localUrl: "http://asr:8000" });
    expect(local.capabilities).toEqual({ transcription: true, extraction: false });
  });

  it("treats blank values as unset and rejects bad values with a readable message", () => {
    expect(loadConfig({ DATABASE_URL: "   ", SITE_PASSWORD: "" }).databaseUrl).toBeUndefined();
    expect(() => loadConfig({ PORT: "99999" })).toThrow(/Invalid environment configuration: PORT/);
    expect(() => loadConfig({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ GROQ_API_URL: "not a url" })).toThrow(/GROQ_API_URL/);
  });

  it("derives the app-role URL from the admin URL and the app password, keeping the project suffix", () => {
    const pooled = deriveAppDatabaseUrl("postgresql://postgres.abcdef:AdminPw@aws-0-region.pooler.supabase.com:5432/postgres?sslmode=require", "App#Pw 1"); // secret-scan:allow (invented fixture)
    const u = new URL(pooled);
    expect(u.username).toBe("vetflow_app.abcdef");
    expect(decodeURIComponent(u.password)).toBe("App#Pw 1");
    expect(u.hostname).toBe("aws-0-region.pooler.supabase.com");
    expect(u.search).toBe("");
    expect(new URL(deriveAppDatabaseUrl("postgres://postgres:x@localhost:5432/db", "p")).username).toBe("vetflow_app");
  });

  it("uses the derived URL only when DATABASE_URL is not given", () => {
    const env = { ADMIN_DATABASE_URL: "postgres://postgres.ref:a@h:5432/postgres", APP_DB_PASSWORD: "b" };
    expect(new URL(loadConfig(env).databaseUrl!).username).toBe("vetflow_app.ref");
    expect(loadConfig({ ...env, DATABASE_URL: "postgres://x:y@z/db" }).databaseUrl).toBe("postgres://x:y@z/db");
    expect(loadConfig({ ADMIN_DATABASE_URL: env.ADMIN_DATABASE_URL }).databaseUrl).toBeUndefined();
  });
});

describe("database TLS settings", () => {
  it("uses no TLS for local and Docker hosts", () => {
    expect(poolConfig("postgres://u:p@localhost:5432/db").ssl).toBe(false);
    expect(poolConfig("postgres://u:p@127.0.0.1:5432/db").ssl).toBe(false);
    expect(poolConfig("postgres://u:p@postgres:5432/db").ssl).toBe(false);
  });

  it("always verifies certificates for remote hosts, and trusts a CA file when given", () => {
    const remote = poolConfig("postgres://u:p@db.example.com:5432/db?sslmode=disable");
    expect(remote.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(remote.connectionString).not.toContain("sslmode");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-ca-"));
    const ca = path.join(dir, "ca.crt");
    fs.writeFileSync(ca, "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n");
    expect(poolConfig("postgres://u:p@db.example.com/db", ca).ssl).toMatchObject({ rejectUnauthorized: true, ca: expect.stringContaining("BEGIN CERTIFICATE") });
    expect(() => poolConfig("postgres://u:p@db.example.com/db", path.join(dir, "missing.crt"))).toThrow(/does not exist/);
  });

  it("there is no way to turn verification off", () => {
    for (const host of ["db.example.com", "x.supabase.com", "10.0.0.5"]) {
      for (const qs of ["", "?sslmode=disable", "?sslmode=no-verify", "?ssl=false"]) {
        const ssl = poolConfig(`postgres://u:p@${host}:5432/db${qs}`).ssl;
        expect(ssl && typeof ssl === "object" ? ssl.rejectUnauthorized : "off").toBe(true);
      }
    }
  });
});
