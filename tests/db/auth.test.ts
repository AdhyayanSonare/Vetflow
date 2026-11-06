import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { can } from "../../server/auth/permissions";
import { hashPassword, passwordProblem, verifyPassword } from "../../server/auth/service";
import { adminUrl, appUrl, createTenant, serve } from "../helpers";

let pool: pg.Pool, admin: pg.Pool;
const PW = "Correct-horse-9";
let n = 0;

async function user(role = "vet") {
  const t = await createTenant(`Auth${n++}`);
  const email = `u${Date.now()}${n}@clinic.test`;
  await admin.query("update users set email=$2, role=$3, password_hash=$4 where id=$1", [t.userId, email, role, await hashPassword(PW)]);
  return { ...t, email };
}
const appWith = () => {
  const app = createApp(pool);
  const tokens: string[] = [];
  app.locals.onResetToken = (_e: string, t: string) => tokens.push(t);
  return { app, tokens };
};

beforeAll(() => { pool = new pg.Pool({ connectionString: appUrl(), max: 6 }); admin = new pg.Pool({ connectionString: adminUrl() }); });
afterAll(async () => { await pool.end(); await admin.end(); });

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const h = await hashPassword(PW);
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, PW)).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
  });
  it("enforces a minimum policy", () => {
    expect(passwordProblem("short1")).toBeTruthy();
    expect(passwordProblem("alllettersnodigits")).toBeTruthy();
    expect(passwordProblem(PW)).toBeNull();
  });
});

describe("sign-in and sessions", () => {
  it("signs in, sets an HttpOnly SameSite cookie, and returns the user", async () => {
    const u = await user("pharmacist");
    const { app } = appWith(); const s = await serve(app);
    const r = await s.call("POST", "/api/auth/login", { email: u.email, password: PW });
    expect(r.status).toBe(200);
    expect(r.json.user.role).toBe("pharmacist");
    const cookie = r.headers.getSetCookie()[0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await s.call("GET", "/api/auth/me")).json.user.email).toBe(u.email);
    await s.close();
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const u = await user();
    const { app } = appWith(); const s = await serve(app);
    const a = await s.call("POST", "/api/auth/login", { email: u.email, password: "Wrong-pass-1" });
    const b = await s.call("POST", "/api/auth/login", { email: "nobody@clinic.test", password: "Wrong-pass-1" });
    expect(a.status).toBe(401); expect(b.status).toBe(401);
    expect(a.json.error.message).toBe(b.json.error.message);
    await s.close();
  });

  it("locks the account after five failed sign-ins and writes an audit row", async () => {
    const u = await user();
    const { app } = appWith(); const s = await serve(app);
    for (let i = 0; i < 5; i++) expect((await s.call("POST", "/api/auth/login", { email: u.email, password: "Wrong-pass-1" })).status).toBe(401);
    expect((await s.call("POST", "/api/auth/login", { email: u.email, password: PW })).status).toBe(423);
    const a = await admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='auth.locked'", [u.tenantId]);
    expect(a.rows[0].n).toBe(1);
    await s.close();
  });

  it("rate-limits sign-in attempts per address and email", async () => {
    const { app } = appWith(); const s = await serve(app);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await s.call("POST", "/api/auth/login", { email: "spray@clinic.test", password: "x" })).status);
    expect(codes.slice(0, 10).every(c => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
    await s.close();
  });

  it("rejects writes without the CSRF header, accepts them with it, and logout ends the session", async () => {
    const u = await user();
    const { app } = appWith(); const s = await serve(app);
    await s.call("POST", "/api/auth/login", { email: u.email, password: PW });
    const bad = await s.call("POST", "/api/auth/logout", {}, { csrf: false });
    expect(bad.status).toBe(403); expect(bad.json.error.code).toBe("csrf");
    expect((await s.call("POST", "/api/auth/logout", {})).status).toBe(200);
    expect((await s.call("GET", "/api/auth/me")).status).toBe(401);
    await s.close();
  });

  it("an expired session is refused", async () => {
    const u = await user();
    const { app } = appWith(); const s = await serve(app);
    await s.call("POST", "/api/auth/login", { email: u.email, password: PW });
    await admin.query("update sessions set expires_at = now() - interval '1 minute' where tenant_id=$1", [u.tenantId]);
    expect((await s.call("GET", "/api/auth/me")).status).toBe(401);
    await s.close();
  });

  it("a deactivated user loses access immediately", async () => {
    const u = await user();
    const { app } = appWith(); const s = await serve(app);
    await s.call("POST", "/api/auth/login", { email: u.email, password: PW });
    await admin.query("update users set active=false where id=$1", [u.userId]);
    expect((await s.call("GET", "/api/auth/me")).status).toBe(401);
    await s.close();
  });
});

describe("password reset", () => {
  it("resets once, ends old sessions, and never reveals whether an email exists", async () => {
    const u = await user();
    const { app, tokens } = appWith(); const s = await serve(app);
    await s.call("POST", "/api/auth/login", { email: u.email, password: PW });
    const known = await s.call("POST", "/api/auth/reset/request", { email: u.email });
    const unknown = await s.call("POST", "/api/auth/reset/request", { email: "ghost@clinic.test" });
    expect(known.json).toEqual(unknown.json);
    expect(tokens).toHaveLength(1);
    expect((await s.call("POST", "/api/auth/reset/complete", { token: tokens[0], password: "short" })).status).toBe(400);
    expect((await s.call("POST", "/api/auth/reset/complete", { token: tokens[0], password: "Brand-new-pass-2" })).status).toBe(200);
    expect((await s.call("POST", "/api/auth/reset/complete", { token: tokens[0], password: "Another-pass-3" })).status).toBe(400);
    expect((await s.call("GET", "/api/auth/me")).status).toBe(401);
    s.clearCookies();
    expect((await s.call("POST", "/api/auth/login", { email: u.email, password: "Brand-new-pass-2" })).status).toBe(200);
    await s.close();
  });
});

describe("headers and permissions", () => {
  it("sets security headers", async () => {
    const { app } = appWith(); const s = await serve(app);
    const r = await s.call("GET", "/api/health");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-powered-by")).toBeNull();
    await s.close();
  });

  it("role permissions: only the right roles can adjust stock or approve prescriptions", () => {
    expect(can("viewer", "stock.adjust")).toBe(false);
    expect(can("pharmacist", "stock.adjust")).toBe(false);
    expect(can("inventory_manager", "stock.adjust")).toBe(true);
    expect(can("pharmacist", "prescription.approve")).toBe(false);
    expect(can("vet", "prescription.approve")).toBe(true);
    expect(can("vet", "stock.override")).toBe(false);
    expect(can("admin", "users.manage")).toBe(true);
  });
});
