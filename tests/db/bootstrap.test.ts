import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createClinic, generatePassword, resetUserPassword } from "../../server/db/bootstrap";
import { passwordProblem } from "../../server/modules/auth/service";
import { adminUrl, appUrl, serve } from "../helpers";

let admin: pg.Pool;
let app: pg.Pool;
beforeAll(() => { admin = new pg.Pool({ connectionString: adminUrl(), max: 3 }); app = new pg.Pool({ connectionString: appUrl(), max: 3 }); });
afterAll(async () => { await admin.end(); await app.end(); });

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe("creating a real clinic", () => {
  it("makes the clinic, a branch with its pharmacy, a head-office store and an admin who can sign in", async () => {
    const tag = unique();
    const r = await createClinic(admin, { clinicName: `Clinic ${tag}`, branchName: "Hilltop", adminEmail: `Owner.${tag}@Example.Test`, adminName: "Asha Rao" });
    expect(r.generatedPassword).toBe(true);
    expect(passwordProblem(r.password)).toBeNull();
    expect(r.adminEmail).toBe(`owner.${tag}@example.test`);

    const stores = (await admin.query("select kind, name from stores where tenant_id = $1 order by kind", [r.tenantId])).rows;
    expect(stores).toEqual([{ kind: "branch", name: "Hilltop pharmacy" }, { kind: "central", name: "Central store" }]);
    expect((await admin.query("select role, active from users where id = $1", [r.adminUserId])).rows[0]).toEqual({ role: "admin", active: true });
    expect((await admin.query("select count(*)::int n from audit_log where tenant_id = $1 and action = 'tenant.create'", [r.tenantId])).rows[0].n).toBe(1);

    const s = await serve(createApp(app));
    try {
      const login = await s.call("POST", "/api/auth/login", { email: r.adminEmail, password: r.password });
      expect(login.status).toBe(200);
      expect(login.json.user.role).toBe("admin");
      expect((await s.call("GET", "/api/branches")).json.map((b: { name: string }) => b.name)).toEqual(["Hilltop"]);
    } finally { await s.close(); }
  });

  it("keeps clinics apart: a second clinic's admin cannot see the first clinic's branch", async () => {
    const a = await createClinic(admin, { clinicName: `A ${unique()}`, branchName: "Alpha", adminEmail: `a.${unique()}@example.test`, adminName: "A" });
    const b = await createClinic(admin, { clinicName: `B ${unique()}`, branchName: "Beta", adminEmail: `b.${unique()}@example.test`, adminName: "B", password: "Own-password-77" });
    expect(b.generatedPassword).toBe(false);
    const s = await serve(createApp(app));
    try {
      await s.call("POST", "/api/auth/login", { email: b.adminEmail, password: "Own-password-77" });
      const names = (await s.call("GET", "/api/branches")).json.map((x: { name: string }) => x.name);
      expect(names).toEqual(["Beta"]);
      expect(a.tenantId).not.toBe(b.tenantId);
    } finally { await s.close(); }
  });

  it("rejects a duplicate email, a weak password and bad input, and leaves nothing behind", async () => {
    const tag = unique();
    const email = `dup.${tag}@example.test`;
    await createClinic(admin, { clinicName: `First ${tag}`, adminEmail: email, adminName: "One" });
    const before = (await admin.query("select count(*)::int n from tenants")).rows[0].n;
    await expect(createClinic(admin, { clinicName: `Second ${tag}`, adminEmail: email.toUpperCase(), adminName: "Two" })).rejects.toThrow(/already belongs/);
    await expect(createClinic(admin, { clinicName: `Weak ${tag}`, adminEmail: `w.${tag}@example.test`, adminName: "W", password: "short" })).rejects.toThrow(/too weak/);
    await expect(createClinic(admin, { clinicName: " ", adminEmail: `x.${tag}@example.test`, adminName: "X" })).rejects.toThrow(/name/);
    await expect(createClinic(admin, { clinicName: "Bad", adminEmail: "not-an-email", adminName: "X" })).rejects.toThrow(/email/);
    expect((await admin.query("select count(*)::int n from tenants")).rows[0].n).toBe(before);
  });

  it("generates passwords that pass the rules and do not repeat", () => {
    const set = new Set(Array.from({ length: 50 }, generatePassword));
    expect(set.size).toBe(50);
    for (const pw of set) { expect(pw).toHaveLength(16); expect(passwordProblem(pw)).toBeNull(); }
  });
});

describe("server-side password reset for a locked-out admin", () => {
  it("sets a new password, clears the lock, ends old sessions and writes an audit row", async () => {
    const tag = unique();
    const r = await createClinic(admin, { clinicName: `Lock ${tag}`, adminEmail: `lock.${tag}@example.test`, adminName: "Locked", password: "Old-password-11" });
    const s = await serve(createApp(app));
    try {
      expect((await s.call("POST", "/api/auth/login", { email: r.adminEmail, password: "Old-password-11" })).status).toBe(200);
      await admin.query("update users set failed_logins = 5, locked_until = now() + interval '1 hour' where id = $1", [r.adminUserId]);
      s.clearCookies();
      expect((await s.call("POST", "/api/auth/login", { email: r.adminEmail, password: "Old-password-11" })).status).toBe(423);

      const reset = await resetUserPassword(admin, r.adminEmail.toUpperCase());
      expect(reset.generatedPassword).toBe(true);
      expect((await admin.query("select count(*)::int n from sessions where user_id = $1", [r.adminUserId])).rows[0].n).toBe(0);
      expect((await admin.query("select count(*)::int n from audit_log where tenant_id = $1 and action = 'user.password_reset_server'", [r.tenantId])).rows[0].n).toBe(1);

      expect((await s.call("POST", "/api/auth/login", { email: r.adminEmail, password: "Old-password-11" })).status).toBe(401);
      expect((await s.call("POST", "/api/auth/login", { email: r.adminEmail, password: reset.password })).status).toBe(200);
    } finally { await s.close(); }
  });

  it("refuses an unknown email and a weak password without changing anything", async () => {
    await expect(resetUserPassword(admin, `nobody.${unique()}@example.test`)).rejects.toThrow(/No user/);
    const tag = unique();
    const r = await createClinic(admin, { clinicName: `W ${tag}`, adminEmail: `w.${tag}@example.test`, adminName: "W", password: "Keep-this-pw-9" });
    await expect(resetUserPassword(admin, r.adminEmail, "short")).rejects.toThrow(/too weak/);
    const s = await serve(createApp(app));
    try { expect((await s.call("POST", "/api/auth/login", { email: r.adminEmail, password: "Keep-this-pw-9" })).status).toBe(200); } finally { await s.close(); }
  });
});
