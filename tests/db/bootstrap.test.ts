import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createClinic, generatePassword } from "../../server/db/bootstrap";
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
