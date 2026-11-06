import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/app";
import type { AsrClient } from "../../server/modules/voice/asr";
import { createTenant, serve } from "../helpers";
import { harness, PW } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

/** A minimal WAV header is enough for the container check. */
const wav = () => Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.alloc(40)]);

const okAsr = (text: string): AsrClient => async () => ({ text, segments: [{ start: 0, end: 2, text }], confidence: 0.9, provider: "fake", language: "en" });

async function signedIn(f: Awaited<ReturnType<typeof createTenant>>, role: string, asr: AsrClient | null) {
  const u = await h.mkUser(f, role);
  const s = await serve(createApp(h.pool, { asr }));
  expect((await s.call("POST", "/api/auth/login", { email: u.email, password: PW })).status).toBe(200);
  return s;
}

describe("transcription route", () => {
  it("returns the transcript and timings for a signed-in vet, and stores nothing", async () => {
    const f = await createTenant("Vx1");
    const s = await signedIn(f, "vet", okAsr("carprofen fifty milligrams twice daily"));
    const r = await s.call("POST", "/api/voice/transcribe?language=en", undefined, { raw: wav(), contentType: "audio/wav" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ transcript: "carprofen fifty milligrams twice daily", provider: "fake", language: "en" });
    expect(r.json.segments).toHaveLength(1);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await h.admin.query("select count(*)::int n from transcripts where tenant_id=$1", [f.tenantId])).rows[0].n).toBe(0);
    expect((await h.admin.query("select count(*)::int n from prescriptions where tenant_id=$1", [f.tenantId])).rows[0].n).toBe(0);
    await s.close();
  });

  it("needs sign-in and the right role, and respects the tenant voice switch", async () => {
    const f = await createTenant("Vx2");
    const anon = await serve(createApp(h.pool, { asr: okAsr("x") }));
    expect((await anon.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "audio/wav" })).status).toBe(401);
    const viewer = await signedIn(f, "viewer", okAsr("x"));
    expect((await viewer.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "audio/wav" })).status).toBe(403);
    const vet = await signedIn(f, "vet", okAsr("hello"));
    await h.admin.query("update tenant_settings set voice_enabled=false where tenant_id=$1", [f.tenantId]);
    const off = await vet.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "audio/wav" });
    expect(off.status).toBe(403);
    expect(off.json.error.code).toBe("voice_disabled");
    await anon.close(); await viewer.close(); await vet.close();
  });

  it("rejects empty audio, the wrong type, bytes that are not audio, and files over the limit", async () => {
    const f = await createTenant("Vx3");
    const s = await signedIn(f, "vet", okAsr("hello"));
    expect((await s.call("POST", "/api/voice/transcribe", undefined, { raw: Buffer.alloc(0), contentType: "audio/wav" })).json.error.code).toBe("EMPTY_AUDIO");
    expect((await s.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "text/plain" })).status).toBe(415);
    expect((await s.call("POST", "/api/voice/transcribe", undefined, { raw: Buffer.from("this is not audio at all"), contentType: "audio/wav" })).status).toBe(415);
    const big = Buffer.concat([wav(), Buffer.alloc(26 * 1024 * 1024)]);
    expect((await s.call("POST", "/api/voice/transcribe", undefined, { raw: big, contentType: "audio/wav" })).status).toBeGreaterThanOrEqual(400);
    await s.close();
  });

  it("reports a failed or silent transcription clearly, and a missing service as not configured", async () => {
    const f = await createTenant("Vx4");
    const broken = await signedIn(f, "vet", async () => { throw new Error("down"); });
    expect((await broken.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "audio/wav" })).json.error.code).toBe("SERVICE_ERROR");
    const silent = await signedIn(f, "vet", okAsr("   "));
    expect((await silent.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "audio/wav" })).json.error.code).toBe("NO_SPEECH");
    const none = await signedIn(f, "vet", null);
    expect((await none.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "audio/wav" })).json.error.code).toBe("NOT_CONFIGURED");
    await broken.close(); await silent.close(); await none.close();
  });

  it("limits how many recordings one user can send per minute", async () => {
    const f = await createTenant("Vx5");
    const s = await signedIn(f, "vet", okAsr("hi"));
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await s.call("POST", "/api/voice/transcribe", undefined, { raw: wav(), contentType: "audio/wav" })).status);
    expect(codes.slice(0, 12).every(c => c === 200)).toBe(true);
    expect(codes.slice(12)).toEqual([429, 429]);
    await s.close();
  });
});

describe("turning a transcript into a draft", () => {
  async function world() {
    const w = await h.stocked();
    const add = (b: object) => w.mgr.call("POST", "/api/items", { confirmSimilar: true, ...b });
    const carpro = (await add({ genericName: "Carprofen", strength: "50 mg", unit: "tablet" })).json;
    const amox250 = (await add({ genericName: "Amoxicillin Clavulanate", strength: "250 mg", unit: "tablet" })).json;
    const amox500 = (await add({ genericName: "Amoxicillin Clavulanate", strength: "500 mg", unit: "tablet" })).json;
    const metro = (await add({ genericName: "Metronidazole", strength: "200 mg", unit: "tablet" })).json;
    return { ...w, carpro, amox250, amox500, metro };
  }
  const structure = (w: { vet: { call: Function } }, text: string) => w.vet.call("POST", "/api/voice/structure", { text });

  it("matches a drug, reads dose, frequency and duration, and works out the quantity", async () => {
    const w = await world();
    const r = await structure(w, "Give carprofen 50 mg one tablet twice daily for five days");
    expect(r.status).toBe(200);
    expect(r.json.saved).toBe(false);
    expect(r.json.lines).toHaveLength(1);
    expect(r.json.lines[0]).toMatchObject({
      itemId: w.carpro.id, itemName: "Carprofen", unmatched: false, dose: "one tablet", frequency: "twice daily", duration: "five days", quantity: 10,
    });
  });

  it("picks the strength that matches what was said, and asks when it is ambiguous", async () => {
    const w = await world();
    const exact = await structure(w, "amoxicillin clavulanate 500 mg twice daily for seven days");
    expect(exact.json.lines[0].itemId).toBe(w.amox500.id);
    const vague = await structure(w, "amoxicillin clavulanate twice daily for seven days");
    expect(vague.json.lines[0].itemId).toBeNull();
    expect(vague.json.lines[0].unmatched).toBe(true);
    expect(vague.json.lines[0].candidates.length).toBeGreaterThanOrEqual(2);
    expect(vague.json.lines[0].reason).toMatch(/strength/);
  });

  it("handles several drugs in one dictation, and flags a drug that is not in the catalogue", async () => {
    const w = await world();
    const r = await structure(w, "Start carprofen 50 mg one tablet twice daily for five days and metronidazole 200 mg one tablet three times a day for 3 days. Also prednisolone 5 mg once daily orally.");
    const names = r.json.lines.map((l: { drugText: string }) => l.drugText);
    expect(names).toEqual(expect.arrayContaining(["carprofen", "metronidazole", "prednisolone"]));
    const byName = Object.fromEntries(r.json.lines.map((l: { drugText: string }) => [l.drugText, l]));
    expect(byName.carprofen.itemId).toBe(w.carpro.id);
    expect(byName.metronidazole).toMatchObject({ itemId: w.metro.id, frequency: "three times daily", quantity: 9 });
    expect(byName.prednisolone).toMatchObject({ itemId: null, unmatched: true, route: "oral", frequency: "once daily" });
    expect(byName.prednisolone.reason).toMatch(/Not found/);
  });

  it("tolerates a small mis-hearing of a drug name", async () => {
    const w = await world();
    const r = await structure(w, "give carprofin fifty milligrams once daily");
    expect(r.json.lines[0].itemId).toBe(w.carpro.id);
  });

  it("matches a drug name that the recogniser split into pieces", async () => {
    const w = await world();
    const r = await structure(w, "give car pro fn 50 milligrams one tablet twice daily for five days");
    expect(r.json.lines).toHaveLength(1);
    expect(r.json.lines[0]).toMatchObject({ itemId: w.carpro.id, unmatched: false, frequency: "twice daily", quantity: 10 });
  });

  it("returns nothing for speech with no drug, and never saves a prescription or moves stock", async () => {
    const w = await world();
    const before = await h.total(w.item.id);
    const r = await structure(w, "The dog is eating well and the owner is happy with the recovery");
    expect(r.json.lines).toEqual([]);
    await structure(w, "carprofen 50 mg one tablet daily for 5 days");
    expect((await h.admin.query("select count(*)::int n from prescriptions where tenant_id=$1", [w.f.tenantId])).rows[0].n).toBe(0);
    expect(await h.total(w.item.id)).toBe(before);
    expect((await w.pharm.call("POST", "/api/voice/structure", { text: "x" })).status).toBe(403);
    expect((await w.vet.call("POST", "/api/voice/structure", { text: "" })).status).toBe(400);
  });

  it("a draft goes through the same approval as a typed prescription: unmatched lines block approval", async () => {
    const w = await world();
    const draft = (await structure(w, "carprofen 50 mg one tablet twice daily for five days and prednisolone 5 mg once daily")).json.lines;
    const animal = (await w.vet.call("POST", "/api/animals", { name: "Rex", species: "Dog", owner: { name: "Owner" } })).json;
    const consult = (await w.vet.call("POST", "/api/consultations", { animalId: animal.id })).json;
    const rx = (await w.vet.call("POST", "/api/prescriptions", { consultationId: consult.id, source: "voice",
      lines: draft.map((l: { itemId: string | null; drugText: string; dose: string; frequency: string; duration: string; quantity: number | null }) =>
        ({ itemId: l.itemId, drugText: l.drugText, dose: l.dose, frequency: l.frequency, duration: l.duration, quantity: l.quantity })) })).json;
    expect(rx.source).toBe("voice");
    expect(rx.status).toBe("draft");
    const blocked = await w.vet.call("POST", `/api/prescriptions/${rx.id}/approve`);
    expect(blocked.json.error.code).toBe("unmatched_lines");
    expect(await h.total(w.item.id)).toBe(50);
  });

  it("matches only this tenant's catalogue", async () => {
    const a = await world();
    const b = await h.stocked();
    const r = await b.vet.call("POST", "/api/voice/structure", { text: "carprofen 50 mg one tablet daily for 5 days" });
    expect(r.json.lines[0]).toMatchObject({ itemId: null, unmatched: true });
    expect(JSON.stringify(r.json)).not.toContain(a.carpro.id);
  });
});
