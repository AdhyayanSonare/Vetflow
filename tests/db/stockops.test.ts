import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenant } from "../helpers";
import { harness } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

describe("transfers", () => {
  it("dispatch moves stock into transit, receive moves it to the destination, and nothing is consumed", async () => {
    const w = await h.stocked({ qty: 40 });
    const t = (await w.mgr.call("POST", "/api/transfers", { fromStoreId: w.f.storeId, toStoreId: w.store2, lines: [{ itemId: w.item.id, quantity: 15 }] })).json;
    expect(t.status).toBe("draft");
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(40);       // a draft moves nothing

    const sent = await w.mgr.call("POST", `/api/transfers/${t.id}/dispatch`);
    expect(sent.json.status).toBe("dispatched");
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(25);
    expect(await h.balance(w.item.id, w.store2)).toBe(0);
    expect(await h.total(w.item.id)).toBe(40);                       // in transit, not gone
    await w.mgr.call("POST", `/api/transfers/${t.id}/dispatch`);      // repeat is a no-op
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(25);

    const lineId = sent.json.lines[0].id;
    const got = await w.mgr.call("POST", `/api/transfers/${t.id}/receive`, { lines: [{ lineId, receivedQty: 15 }] });
    expect(got.json.status).toBe("received");
    expect(await h.balance(w.item.id, w.store2)).toBe(15);
    expect(await h.total(w.item.id)).toBe(40);
    expect(await h.ledgerTypes(w.item.id)).toEqual(["receipt", "transfer_in", "transfer_out"]);
  });

  it("a short receipt needs a reason, leaves the shortfall in transit, and raises an alert", async () => {
    const w = await h.stocked({ qty: 20 });
    const t = (await w.mgr.call("POST", "/api/transfers", { fromStoreId: w.f.storeId, toStoreId: w.store2, lines: [{ itemId: w.item.id, quantity: 10 }] })).json;
    const sent = (await w.mgr.call("POST", `/api/transfers/${t.id}/dispatch`)).json;
    const lineId = sent.lines[0].id;
    expect((await w.mgr.call("POST", `/api/transfers/${t.id}/receive`, { lines: [{ lineId, receivedQty: 7 }] })).json.error.code).toBe("reason_required");
    expect((await w.mgr.call("POST", `/api/transfers/${t.id}/receive`, { lines: [{ lineId, receivedQty: 11 }] })).json.error.code).toBe("over_received");
    const ok = await w.mgr.call("POST", `/api/transfers/${t.id}/receive`, { lines: [{ lineId, receivedQty: 7, reason: "Box damaged in transit" }] });
    expect(ok.status).toBe(200);
    expect(await h.balance(w.item.id, w.store2)).toBe(7);
    expect(await h.total(w.item.id)).toBe(20);
    expect(ok.json.lines[0]).toMatchObject({ sentQty: 10, receivedQty: 7, discrepancyReason: "Box damaged in transit" });
    const alerts = await h.admin.query("select count(*)::int n from alerts where tenant_id=$1 and kind='transfer_discrepancy'", [w.f.tenantId]);
    expect(alerts.rows[0].n).toBe(1);
    expect((await w.mgr.call("GET", "/api/transfers")).json[0].hasDiscrepancy).toBe(true);
  });

  it("rejects the same store, stock that is not there, and a viewer", async () => {
    const w = await h.stocked({ qty: 5 });
    expect((await w.mgr.call("POST", "/api/transfers", { fromStoreId: w.f.storeId, toStoreId: w.f.storeId, lines: [{ itemId: w.item.id, quantity: 1 }] })).status).toBe(400);
    expect((await w.mgr.call("POST", "/api/transfers", { fromStoreId: w.f.storeId, toStoreId: w.store2, lines: [{ itemId: w.item.id, quantity: 99 }] })).json.error.code).toBe("insufficient");
    const viewer = await h.as(w.f, "viewer");
    expect((await viewer.call("POST", "/api/transfers", { fromStoreId: w.f.storeId, toStoreId: w.store2, lines: [{ itemId: w.item.id, quantity: 1 }] })).status).toBe(403);
  });
});

describe("stock counts", () => {
  it("a variance needs a reason, then posts an adjustment that keeps ledger and balance in step", async () => {
    const w = await h.stocked({ qty: 30 });
    const k = (await w.pharm.call("POST", "/api/counts", { storeId: w.f.storeId })).json;
    expect(k.lines).toHaveLength(1);
    expect(k.lines[0]).toMatchObject({ systemQty: 30, countedQty: 30, variance: 0 });
    const lineId = k.lines[0].id;
    await w.pharm.call("PUT", `/api/counts/${k.id}/lines`, { lines: [{ lineId, countedQty: 27 }] });
    expect((await w.pharm.call("POST", `/api/counts/${k.id}/post`)).status).toBe(403);          // pharmacist counts; a manager posts
    expect((await w.mgr.call("POST", `/api/counts/${k.id}/post`)).json.error.code).toBe("reason_required");
    await w.pharm.call("PUT", `/api/counts/${k.id}/lines`, { lines: [{ lineId, countedQty: 27, reason: "Three tablets spilled" }] });
    const posted = await w.mgr.call("POST", `/api/counts/${k.id}/post`);
    expect(posted.json.status).toBe("posted");
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(27);
    expect(await h.ledgerTypes(w.item.id)).toContain("count_adjustment");
    expect((await w.mgr.call("PUT", `/api/counts/${k.id}/lines`, { lines: [{ lineId, countedQty: 1 }] })).status).toBe(409);
    const again = await w.mgr.call("POST", `/api/counts/${k.id}/post`);
    expect(again.status).toBe(200);
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(27);                                    // posting twice changes nothing
    const rec = await h.admin.query("select count(*)::int n from reconcile_balances($1)", [w.f.tenantId]);
    expect(rec.rows[0].n).toBe(0);
  });

  it("a count higher than the system adds stock", async () => {
    const w = await h.stocked({ qty: 10 });
    const k = (await w.mgr.call("POST", "/api/counts", { storeId: w.f.storeId })).json;
    await w.mgr.call("PUT", `/api/counts/${k.id}/lines`, { lines: [{ lineId: k.lines[0].id, countedQty: 12, reason: "Found a box on the shelf" }] });
    await w.mgr.call("POST", `/api/counts/${k.id}/post`);
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(12);
  });
});

describe("issue, return and write-off", () => {
  it("issue to a department is consumption with a reason; return to store moves stock back without consuming", async () => {
    const w = await h.stocked({ qty: 20 });
    const dep = (await w.mgr.call("POST", "/api/departments", { branchId: w.f.branchId, name: "Surgery" }));
    expect(dep.status).toBe(403);                                                                  // only an admin manages departments
    const admin = await h.as(w.f, "admin");
    const d = (await admin.call("POST", "/api/departments", { branchId: w.f.branchId, name: "Surgery" })).json;
    expect((await w.pharm.call("POST", "/api/stock/issue", { itemId: w.item.id, storeId: w.f.storeId, quantity: 4, departmentId: d.id, reason: "" })).status).toBe(400);
    const r = await w.pharm.call("POST", "/api/stock/issue", { itemId: w.item.id, storeId: w.f.storeId, quantity: 4, departmentId: d.id, reason: "Surgery list" });
    expect(r.status).toBe(201);
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(16);
    const batch = r.json.allocations[0].batchId;
    const back = await w.pharm.call("POST", "/api/stock/return", { itemId: w.item.id, batchId: batch, fromStoreId: w.f.storeId, toStoreId: w.store2, quantity: 2, reason: "Unused" });
    expect(back.status).toBe(201);
    expect(await h.balance(w.item.id, w.store2)).toBe(2);
    expect(await h.total(w.item.id)).toBe(16);
    expect(await h.ledgerTypes(w.item.id)).toEqual(["issue", "receipt", "return_to_store"]);
  });

  it("an expired batch can be written off, and the write-off removes it from stock", async () => {
    const w = await h.stocked({ qty: 6, expiry: -3 });
    const st = (await w.mgr.call("GET", "/api/stock")).json[0];
    expect(st.expired).toBe(true);
    const wo = await w.mgr.call("POST", "/api/stock/adjust", { type: "expiry_writeoff", itemId: w.item.id, batchId: st.batchId, storeId: w.f.storeId, quantity: 6, reason: "Expired" });
    expect(wo.status).toBe(201);
    expect(await h.total(w.item.id)).toBe(0);
  });
});

describe("multi-dose vials", () => {
  it("opening takes one sealed vial, draws reduce the open vial, and it empties", async () => {
    const w = await h.stocked({ qty: 3, multiDose: true });
    const animal = (await w.vet.call("POST", "/api/animals", { name: "Max", species: "Dog", owner: { name: "Priya" } })).json;
    const v = (await w.pharm.call("POST", "/api/vials/open", { itemId: w.item.id, storeId: w.f.storeId })).json;
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(2);
    expect(v).toMatchObject({ volumeMl: 10, remainingMl: 10, status: "open", pastBeyondUse: false });
    expect((await w.pharm.call("POST", `/api/vials/${v.id}/draw`, { ml: 2.5 })).status).toBe(400);   // needs a patient
    const d1 = await w.pharm.call("POST", `/api/vials/${v.id}/draw`, { ml: 2.5, animalId: animal.id });
    expect(d1.json.remainingMl).toBe(7.5);
    expect((await w.pharm.call("POST", `/api/vials/${v.id}/draw`, { ml: 8, animalId: animal.id })).json.error.code).toBe("insufficient");
    const d2 = await w.pharm.call("POST", `/api/vials/${v.id}/draw`, { ml: 7.5, animalId: animal.id });
    expect(d2.json.status).toBe("empty");
    expect((await w.pharm.call("POST", `/api/vials/${v.id}/draw`, { ml: 1, animalId: animal.id })).json.error.code).toBe("vial_closed");
    expect(await h.balance(w.item.id, w.f.storeId)).toBe(2);                                          // draws do not touch sealed stock
  });

  it("a vial past its beyond-use date cannot be drawn from and can be discarded with a reason", async () => {
    const w = await h.stocked({ qty: 2, multiDose: true });
    const animal = (await w.vet.call("POST", "/api/animals", { name: "Bella", species: "Cat", owner: { name: "Amit" } })).json;
    const v = (await w.pharm.call("POST", "/api/vials/open", { itemId: w.item.id, storeId: w.f.storeId })).json;
    await h.admin.query("update open_vials set beyond_use_at = now() - interval '1 day' where id = $1", [v.id]);
    expect((await w.pharm.call("POST", `/api/vials/${v.id}/draw`, { ml: 1, animalId: animal.id })).json.error.code).toBe("beyond_use");
    expect((await w.pharm.call("GET", "/api/vials")).json[0].pastBeyondUse).toBe(true);
    expect((await w.pharm.call("POST", `/api/vials/${v.id}/discard`, { reason: "Past beyond-use date" })).status).toBe(403);
    expect((await w.mgr.call("POST", `/api/vials/${v.id}/discard`, { reason: "Past beyond-use date" })).status).toBe(200);
    expect((await w.mgr.call("GET", "/api/vials?status=discarded")).json).toHaveLength(1);
  });

  it("refuses to open a vial for an item that is not multi-dose", async () => {
    const w = await h.stocked({ qty: 3 });
    expect((await w.pharm.call("POST", "/api/vials/open", { itemId: w.item.id, storeId: w.f.storeId })).json.error.code).toBe("not_multi_dose");
  });
});

describe("tenant isolation for stock operations", () => {
  it("another tenant cannot dispatch, receive, count, post or draw on this tenant's records", async () => {
    const a = await h.stocked({ qty: 20, multiDose: true });
    const b = await h.stocked({ qty: 5 });
    const t = (await a.mgr.call("POST", "/api/transfers", { fromStoreId: a.f.storeId, toStoreId: a.store2, lines: [{ itemId: a.item.id, quantity: 1 }] })).json;
    const k = (await a.mgr.call("POST", "/api/counts", { storeId: a.f.storeId })).json;
    const v = (await a.pharm.call("POST", "/api/vials/open", { itemId: a.item.id, storeId: a.f.storeId })).json;
    expect((await b.mgr.call("GET", `/api/transfers/${t.id}`)).status).toBe(404);
    expect((await b.mgr.call("POST", `/api/transfers/${t.id}/dispatch`)).status).toBe(404);
    expect((await b.mgr.call("GET", `/api/counts/${k.id}`)).status).toBe(404);
    expect((await b.mgr.call("POST", `/api/counts/${k.id}/post`)).status).toBe(404);
    expect((await b.pharm.call("POST", `/api/vials/${v.id}/discard`, { reason: "attack" })).status).toBe(403);
    expect((await b.mgr.call("POST", `/api/vials/${v.id}/discard`, { reason: "attack attempt" })).status).toBe(409);
    expect((await b.mgr.call("POST", "/api/transfers", { fromStoreId: a.f.storeId, toStoreId: b.f.storeId, lines: [{ itemId: b.item.id, quantity: 1 }] })).status).toBe(404);
    expect((await b.mgr.call("POST", "/api/counts", { storeId: a.f.storeId })).status).toBe(404);
    expect((await b.mgr.call("POST", "/api/stock/issue", { itemId: a.item.id, storeId: b.f.storeId, quantity: 1, reason: "attack" })).status).toBe(404);
    expect((await b.mgr.call("GET", "/api/vials")).json.map((x: { id: string }) => x.id)).not.toContain(v.id);
    expect(await h.balance(a.item.id, a.f.storeId)).toBe(19);   // 20 minus the one sealed vial opened
    const other = await createTenant("Unused");
    expect(other.tenantId).toBeTruthy();
  });
});
