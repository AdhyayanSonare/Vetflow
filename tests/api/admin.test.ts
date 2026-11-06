import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import { createTenant, serve } from "../helpers";
import { harness, PW } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

async function adminWorld() {
  const w = await h.stocked();
  const admin = await h.as(w.f, "admin");
  return { ...w, admin };
}

describe("user management", () => {
  it("an admin creates a user with branches, who can then sign in; the action is audited", async () => {
    const w = await adminWorld();
    const email = `new${Date.now()}@clinic.test`;
    const weak = await w.admin.call("POST", "/api/users", { email, name: "Nina", role: "vet", password: "short" });
    expect(weak.status).toBe(400);
    const r = await w.admin.call("POST", "/api/users", { email, name: "Nina", role: "vet", password: "Fresh-start-77", branchIds: [w.f.branchId] });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ role: "vet", branchIds: [w.f.branchId] });
    expect((await w.admin.call("POST", "/api/users", { email, name: "Nina", role: "vet", password: "Fresh-start-77" })).json.error.code).toBe("duplicate");
    const s = await serve(createApp(h.pool));
    expect((await s.call("POST", "/api/auth/login", { email, password: "Fresh-start-77" })).status).toBe(200);
    await s.close();
    const audit = (await w.admin.call("GET", "/api/reports/audit")).json.rows.map((x: { action: string }) => x.action);
    expect(audit).toContain("user.create");
  });

  it("only admins can manage users, settings and subscription", async () => {
    const w = await adminWorld();
    for (const c of [w.mgr, w.pharm, w.vet]) {
      expect((await c.call("GET", "/api/users")).status).toBe(403);
      expect((await c.call("GET", "/api/settings")).status).toBe(403);
      expect((await c.call("PATCH", "/api/settings", { voiceEnabled: false })).status).toBe(403);
      expect((await c.call("GET", "/api/subscription")).status).toBe(403);
      expect((await c.call("POST", "/api/branches", { name: "X" })).status).toBe(403);
    }
    expect((await w.admin.call("GET", "/api/users")).status).toBe(200);
  });

  it("changing a role or deactivating a user ends their sessions immediately", async () => {
    const w = await adminWorld();
    const victim = await h.as(w.f, "pharmacist");
    expect((await victim.call("GET", "/api/items")).status).toBe(200);
    await w.admin.call("PATCH", `/api/users/${victim.userId}`, { active: false });
    expect((await victim.call("GET", "/api/items")).status).toBe(401);
    const other = await h.as(w.f, "viewer");
    await w.admin.call("PATCH", `/api/users/${other.userId}`, { role: "vet" });
    expect((await other.call("GET", "/api/items")).status).toBe(401);
  });

  it("the last active admin cannot be demoted or deactivated", async () => {
    const f = await createTenant("LastAdmin");
    const only = await h.as(f, "admin");
    // With a second admin present, demoting one is allowed.
    const spare = await h.as(f, "admin");
    expect((await only.call("PATCH", `/api/users/${spare.userId}`, { role: "viewer" })).status).toBe(200);
    // Now `only` is the last active admin (the fixture's own admin user is deactivated first).
    await h.admin.query("update users set active=false where tenant_id=$1 and id <> $2 and role='admin'", [f.tenantId, only.userId]);
    const r1 = await only.call("PATCH", `/api/users/${only.userId}`, { role: "viewer" });
    expect(r1.status).toBe(409);
    expect(r1.json.error.code).toBe("last_admin");
    expect((await only.call("PATCH", `/api/users/${only.userId}`, { active: false })).json.error.code).toBe("last_admin");
  });

  it("an admin can reset a locked user's password, which unlocks the account", async () => {
    const w = await adminWorld();
    const u = await h.mkUser(w.f, "vet");
    for (let i = 0; i < 5; i++) {
      const s = await serve(createApp(h.pool));
      await s.call("POST", "/api/auth/login", { email: u.email, password: "Wrong-pass-1" });
      await s.close();
    }
    const locked = await serve(createApp(h.pool));
    expect((await locked.call("POST", "/api/auth/login", { email: u.email, password: PW })).status).toBe(423);
    await w.admin.call("PATCH", `/api/users/${u.id}`, { password: "Reset-by-admin-5" });
    expect((await locked.call("POST", "/api/auth/login", { email: u.email, password: "Reset-by-admin-5" })).status).toBe(200);
    await locked.close();
  });
});

describe("settings and feature flags", () => {
  it("defaults to voice on and barcode off; every user can read the flags; only admins change them; changes are audited", async () => {
    const w = await adminWorld();
    expect((await w.vet.call("GET", "/api/features")).json).toMatchObject({ voice: true, barcode: false });
    const r = await w.admin.call("PATCH", "/api/settings", { voiceEnabled: false, barcodeEnabled: true, expiryAlertDays: [120, 45] });
    expect(r.json).toMatchObject({ voiceEnabled: false, barcodeEnabled: true, expiryAlertDays: [120, 45] });
    expect((await w.vet.call("GET", "/api/features")).json).toMatchObject({ voice: false, barcode: true });
    expect((await w.admin.call("PATCH", "/api/settings", { asrDefaultLanguage: "xx" })).status).toBe(400);
    const audit = (await w.admin.call("GET", "/api/reports/audit")).json.rows;
    expect(audit.some((x: { action: string; details: string }) => x.action === "settings.update")).toBe(true);
  });

  it("with voice and barcode both off, the stock and clinical workflows still complete", async () => {
    const w = await adminWorld();
    await w.admin.call("PATCH", "/api/settings", { voiceEnabled: false, barcodeEnabled: false });
    const animal = (await w.vet.call("POST", "/api/animals", { name: "Coco", species: "Cat", owner: { name: "Neha" } })).json;
    const consult = (await w.vet.call("POST", "/api/consultations", { animalId: animal.id, complaint: "Limping" })).json;
    const rx = (await w.vet.call("POST", "/api/prescriptions", { consultationId: consult.id, lines: [{ itemId: w.item.id, drugText: "Item", quantity: 2 }] })).json;
    await w.vet.call("POST", `/api/prescriptions/${rx.id}/approve`);
    const d = (await w.pharm.call("POST", "/api/dispenses", { storeId: w.f.storeId, prescriptionId: rx.id, lines: [{ itemId: w.item.id, quantity: 2 }] })).json;
    expect((await w.pharm.call("POST", `/api/dispenses/${d.id}/confirm`, {})).status).toBe(200);
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(48);
  });
});

describe("subscription and licences", () => {
  it("stores plan and billing period, and lists the model attribution", async () => {
    const w = await adminWorld();
    const r = await w.admin.call("PUT", "/api/subscription", { plan: "standard", billingPeriod: "quarterly", nextInvoiceDate: "2026-12-01" });
    expect(r.status).toBe(200);
    expect((await w.admin.call("GET", "/api/subscription")).json).toMatchObject({ billingPeriod: "quarterly", nextInvoiceDate: "2026-12-01", invoices: [] });
    expect((await w.admin.call("PUT", "/api/subscription", { plan: "x", billingPeriod: "weekly" })).status).toBe(400);
    const lic = (await w.pharm.call("GET", "/api/licences")).json;
    expect(lic.models[0]).toMatchObject({ name: "Canary-180M-Flash", by: "NVIDIA", licence: "CC-BY-4.0" });
  });
});

describe("tenant isolation in admin routes", () => {
  it("another tenant's admin cannot see or change this tenant's users, settings or subscription", async () => {
    const a = await adminWorld();
    const b = await adminWorld();
    expect(JSON.stringify((await b.admin.call("GET", "/api/users")).json)).not.toContain(a.admin.userId);
    expect((await b.admin.call("PATCH", `/api/users/${a.vet.userId}`, { active: false })).status).toBe(404);
    await a.admin.call("PATCH", "/api/settings", { voiceEnabled: false });
    expect((await b.vet.call("GET", "/api/features")).json.voice).toBe(true);
    expect((await b.admin.call("POST", "/api/users", { email: `x${Date.now()}@c.test`, name: "X", role: "viewer", password: "Fresh-start-77", branchIds: [a.f.branchId] })).status).toBe(404);
    // Branch names are unique per tenant, not globally: a new name works, and a repeat inside the tenant does not.
    expect((await b.admin.call("POST", "/api/branches", { name: `Branch ${Date.now()}` })).status).toBe(201);
    expect((await b.admin.call("POST", "/api/branches", { name: "Main" })).status).toBe(409);
  });
});
