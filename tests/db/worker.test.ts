import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNightly, runTenantChecks } from "../../server/jobs/nightly";
import { NIGHTLY_QUEUE, startWorker } from "../../server/jobs/worker";
import type { JobResult } from "../../server/jobs/nightly";
import { adminUrl } from "../helpers";
import { harness } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

describe("transcript retention", () => {
  async function withTranscripts(days: number) {
    const w = await h.stocked();
    const animal = (await w.vet.call("POST", "/api/animals", { name: "Rex", species: "Dog", owner: { name: "Owner" } })).json;
    const consult = (await w.vet.call("POST", "/api/consultations", { animalId: animal.id })).json;
    await w.vet.call("POST", `/api/consultations/${consult.id}/transcripts`, { language: "en", provider: "test", text: "old transcript" });
    await w.vet.call("POST", `/api/consultations/${consult.id}/transcripts`, { language: "en", provider: "test", text: "new transcript" });
    await h.admin.query("update tenant_settings set transcript_retention_days=$2 where tenant_id=$1", [w.f.tenantId, days]);
    await h.admin.query("update transcripts set created_at = now() - interval '40 days' where tenant_id=$1 and text='old transcript'", [w.f.tenantId]);
    return w;
  }
  const count = async (tenant: string) => Number((await h.admin.query("select count(*)::int n from transcripts where tenant_id=$1", [tenant])).rows[0].n);

  it("deletes transcripts older than the tenant's retention and records it in the audit log", async () => {
    const w = await withTranscripts(30);
    expect((await runTenantChecks(h.pool, w.f.tenantId)).transcriptsPurged).toBe(1);
    expect(await count(w.f.tenantId)).toBe(1);
    const audit = await h.admin.query("select after from audit_log where tenant_id=$1 and action='transcripts.purge'", [w.f.tenantId]);
    expect(audit.rows[0].after).toMatchObject({ count: 1, retentionDays: 30 });
    expect((await runTenantChecks(h.pool, w.f.tenantId)).transcriptsPurged).toBe(0);
  });

  it("keeps everything when retention is 0, and only touches the tenant whose retention has passed", async () => {
    const keep = await withTranscripts(0);
    const purge = await withTranscripts(30);
    const res = await runNightly(h.pool);
    expect(res.transcriptsPurged).toBeGreaterThanOrEqual(1);
    expect(await count(keep.f.tenantId)).toBe(2);
    expect(await count(purge.f.tenantId)).toBe(1);
  });
});

describe("job runner (pg-boss)", () => {
  it("schedules the nightly job and runs it on demand against the real database", async () => {
    const w = await h.stocked({ qty: 5 });
    await h.admin.query("update stock_balances set quantity = 77 where item_id = $1", [w.item.id]);      // a deliberately wrong balance
    const runs: JobResult[] = [];
    const worker = await startWorker({ adminUrl: adminUrl(), pool: h.pool, onRun: r => runs.push(r) });
    try {
      await worker.runNow();
      const deadline = Date.now() + 20_000;
      while (!runs.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 250));
      expect(runs).toHaveLength(1);
      expect(runs[0].reconciliationProblems).toBeGreaterThanOrEqual(1);
      expect((await w.mgr.call("GET", "/api/alerts")).json.some((a: { kind: string }) => a.kind === "reconciliation")).toBe(true);
      const sched = await h.admin.query("select name, cron, timezone from pgboss.schedule where name = $1", [NIGHTLY_QUEUE]);
      expect(sched.rows[0]).toMatchObject({ cron: "30 2 * * *", timezone: "Asia/Kolkata" });
    } finally {
      await worker.stop();
      await h.admin.query("update stock_balances set quantity = 5 where item_id = $1", [w.item.id]);
    }
  }, 60_000);
});

void pg;
