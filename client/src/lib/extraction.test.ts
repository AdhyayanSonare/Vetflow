import { describe, expect, it, vi } from "vitest";
import { extractConsultationDetails } from "./extraction";

const ok = { notes: { complaint: "cough", duration: "", examination: "", diagnosis: "", treatment: "", followUp: "" }, medicines: [], model: "m" };

describe("extractConsultationDetails", () => {
  it("posts the transcript as JSON and returns the structured result", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(ok)));
    await expect(extractConsultationDetails("Bella has a cough", { fetchImpl })).resolves.toEqual(ok);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/consultation/extract");
    expect(JSON.parse(init.body as string)).toEqual({ transcript: "Bella has a cough" });
  });
  it("surfaces server messages and handles network failure", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { code: "SERVICE_ERROR", message: "try again" } }), { status: 502 }));
    await expect(extractConsultationDetails("x", { fetchImpl: bad })).rejects.toMatchObject({ code: "SERVICE_ERROR", message: "try again" });
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(extractConsultationDetails("x", { fetchImpl: down })).rejects.toMatchObject({ code: "NETWORK" });
  });
  it("rejects a malformed success payload", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ hello: 1 })));
    await expect(extractConsultationDetails("x", { fetchImpl })).rejects.toMatchObject({ code: "SERVICE_ERROR" });
  });
});
