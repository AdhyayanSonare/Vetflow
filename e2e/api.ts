import { request, type APIRequestContext } from "@playwright/test";
import type { DemoRole } from "../shared/demo";

/**
 * A small API client for test set-up and for checking results independently of the screen.
 * It reuses the session saved by auth.setup.ts, so it adds no sign-ins (which are rate limited).
 */
export class Api {
  private constructor(private ctx: APIRequestContext, private csrf: string) {}

  static async as(role: DemoRole, baseURL: string): Promise<Api> {
    const ctx = await request.newContext({ baseURL, storageState: `e2e/.auth/${role}.json` });
    const me = await ctx.get("/api/auth/me");
    if (!me.ok()) throw new Error(`Not signed in as ${role} (${me.status()}). Did auth.setup run?`);
    return new Api(ctx, ((await me.json()) as { csrfToken: string }).csrfToken);
  }

  async get<T = unknown>(path: string): Promise<T> {
    const r = await this.ctx.get(path);
    if (!r.ok()) throw new Error(`GET ${path} -> ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  }

  async send<T = unknown>(method: "post" | "patch" | "put", path: string, data?: unknown): Promise<T> {
    const r = await this.ctx[method](path, { data, headers: { "x-csrf-token": this.csrf } });
    if (!r.ok()) throw new Error(`${method.toUpperCase()} ${path} -> ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  }

  dispose() { return this.ctx.dispose(); }
}

type ItemRow = { id: string; genericName: string; strength: string | null; unit: string; onHand: number };

/** Total units of one item across all stores, read through the API. */
export async function onHand(api: Api, itemId: string): Promise<number> {
  const rows = await api.get<ItemRow[]>(`/api/items?limit=200`);
  const row = rows.find(r => r.id === itemId);
  if (!row) throw new Error(`Item ${itemId} not found`);
  return row.onHand;
}

/** An item that is in stock in the branch pharmacy, by name. */
export async function stockedItem(api: Api, name: string): Promise<ItemRow> {
  const rows = await api.get<ItemRow[]>(`/api/items?q=${encodeURIComponent(name)}&limit=20`);
  const hit = rows.find(r => r.onHand >= 30);
  if (!hit) throw new Error(`No ${name} with at least 30 units in stock in the demo data`);
  return hit;
}

/** A brand-new patient with an approved prescription for `quantity` of an item, ready to dispense. */
export async function approvedPrescription(vet: Api, itemId: string, drugText: string, quantity: number) {
  const tag = Math.random().toString(36).slice(2, 7).toUpperCase();
  const animal = await vet.send<{ id: string; name: string }>("post", "/api/animals", {
    name: `Rex ${tag}`, species: "Dog", breed: "Labrador", owner: { name: `Owner ${tag}`, phone: "9876500000" },
  });
  const consultation = await vet.send<{ id: string }>("post", "/api/consultations", { animalId: animal.id, complaint: "Check-up", temperatureF: 101.5 });
  const rx = await vet.send<{ id: string }>("post", "/api/prescriptions", {
    consultationId: consultation.id, lines: [{ itemId, drugText, dose: "1 tablet", frequency: "twice daily", duration: "5 days", quantity }],
  });
  await vet.send("post", `/api/prescriptions/${rx.id}/approve`, {});
  return { animalName: animal.name, prescriptionId: rx.id };
}
