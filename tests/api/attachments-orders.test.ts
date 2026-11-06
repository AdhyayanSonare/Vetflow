import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { days, harness } from "../harness";

const h = harness();
beforeAll(async () => { await h.init(); });
afterAll(async () => { await h.done(); });

const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const pdf = () => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);

describe("attachments", () => {
  it("stores a PDF or image, identifies it by content, and serves it back safely", async () => {
    const w = await h.stocked();
    const up = await w.mgr.call("POST", "/api/attachments", undefined, { raw: pdf(), contentType: "application/octet-stream", headers: { "x-filename": "Invoice 42 <final>.pdf" } });
    expect(up.status).toBe(201);
    expect(up.json).toMatchObject({ contentType: "application/pdf", sizeBytes: 73 });
    expect(up.json.filename).not.toMatch(/[<>]/);
    const down = await w.pharm.call("GET", `/api/attachments/${up.json.id}`);
    expect(down.status).toBe(200);
    expect(down.headers.get("content-type")).toBe("application/pdf");
    expect(down.headers.get("content-security-policy")).toContain("sandbox");
    expect(down.headers.get("x-content-type-options")).toBe("nosniff");
    expect(down.buf.subarray(0, 4).toString()).toBe("%PDF");
    const img = await w.mgr.call("POST", "/api/attachments", undefined, { raw: png(), contentType: "text/html" });
    expect(img.json.contentType).toBe("image/png");          // the claimed type is ignored
  });

  it("rejects files that are not PDF or images, empty uploads, oversized uploads and unauthorised roles", async () => {
    const w = await h.stocked();
    expect((await w.mgr.call("POST", "/api/attachments", undefined, { raw: Buffer.from("<script>alert(1)</script>"), contentType: "image/png" })).status).toBe(415);
    expect((await w.mgr.call("POST", "/api/attachments", undefined, { raw: Buffer.alloc(0), contentType: "application/pdf" })).status).toBe(400);
    expect((await w.mgr.call("POST", "/api/attachments", undefined, { raw: Buffer.concat([pdf(), Buffer.alloc(9 * 1024 * 1024)]), contentType: "application/pdf" })).status).toBeGreaterThanOrEqual(400);
    expect((await w.vet.call("POST", "/api/attachments", undefined, { raw: pdf(), contentType: "application/pdf" })).status).toBe(403);
  });

  it("attaches an invoice to a receipt, and another tenant can neither read it nor attach it", async () => {
    const a = await h.stocked();
    const b = await h.stocked();
    const up = (await a.mgr.call("POST", "/api/attachments", undefined, { raw: pdf(), contentType: "application/pdf" })).json;
    const rc = await a.mgr.call("POST", "/api/receipts", { supplierId: a.sup.id, storeId: a.f.storeId, attachmentId: up.id,
      lines: [{ itemId: a.item.id, batchNo: "A1", expiryDate: days(200), quantity: 1, unitCostPaise: 1 }] });
    expect(rc.status).toBe(201);
    expect((await b.mgr.call("GET", `/api/attachments/${up.id}`)).status).toBe(404);
    const stolen = await b.mgr.call("POST", "/api/receipts", { supplierId: b.sup.id, storeId: b.f.storeId, attachmentId: up.id,
      lines: [{ itemId: b.item.id, batchNo: "B1", expiryDate: days(200), quantity: 1, unitCostPaise: 1 }] });
    expect(stolen.status).toBe(404);
  });
});

describe("purchase orders with partial receipts", () => {
  async function order(w: Awaited<ReturnType<typeof h.stocked>>, qty = 100) {
    const po = await w.mgr.call("POST", "/api/purchase-orders", { supplierId: w.sup.id, storeId: w.f.storeId, expectedDate: days(7),
      lines: [{ itemId: w.item.id, quantity: qty, unitCostPaise: 250 }] });
    expect(po.status).toBe(201);
    return po.json;
  }

  it("draft, send, receive part, confirm, receive the rest: stock rises only on confirmation and the order closes", async () => {
    const w = await h.stocked({ qty: 5 });
    const po = await order(w);
    expect(po).toMatchObject({ status: "draft", number: expect.stringMatching(/^PO-\d{6}$/) });
    const lineId = po.lines[0].id;
    const recv = (qty: number, batch: string) => w.pharm.call("POST", `/api/purchase-orders/${po.id}/receive`, { invoiceNo: "S-1", lines: [{ poLineId: lineId, quantity: qty, batchNo: batch, expiryDate: days(365) }] });

    expect((await recv(10, "P1")).json.error.code).toBe("invalid");                    // not sent yet
    expect((await w.pharm.call("POST", `/api/purchase-orders/${po.id}/send`)).status).toBe(403);
    expect((await w.mgr.call("POST", `/api/purchase-orders/${po.id}/send`)).json.status).toBe("sent");
    expect((await w.mgr.call("POST", `/api/purchase-orders/${po.id}/send`)).status).toBe(409);

    const part = await recv(60, "P1");
    expect(part.status).toBe(201);
    expect(await h.total(w.item.id)).toBe(5);                                         // a draft receipt moves nothing
    expect((await recv(50, "P2")).json.error.code).toBe("over_received");               // 60 is already on a draft
    await w.mgr.call("POST", `/api/receipts/${part.json.receiptId}/confirm`);
    expect(await h.total(w.item.id)).toBe(65);
    await w.mgr.call("POST", `/api/receipts/${part.json.receiptId}/confirm`);            // confirming again changes nothing
    const mid = (await w.mgr.call("GET", `/api/purchase-orders/${po.id}`)).json;
    expect(mid).toMatchObject({ status: "partially_received" });
    expect(mid.lines[0]).toMatchObject({ orderedQty: 100, receivedQty: 60, outstandingQty: 40 });
    expect((await w.mgr.call("POST", `/api/purchase-orders/${po.id}/cancel`)).status).toBe(409);

    const rest = await recv(40, "P2");
    await w.mgr.call("POST", `/api/receipts/${rest.json.receiptId}/confirm`);
    expect((await w.mgr.call("GET", `/api/purchase-orders/${po.id}`)).json).toMatchObject({ status: "received" });
    expect(await h.total(w.item.id)).toBe(105);
    expect((await recv(1, "P3")).status).toBe(409);                                     // nothing left, and the order is closed
    const stockLedgerRows = await h.admin.query("select count(*)::int n from stock_ledger where tenant_id=$1 and type='receipt'", [w.f.tenantId]);
    expect(stockLedgerRows.rows[0].n).toBe(3);                                          // opening receipt + two deliveries
  });

  it("cancels a sent order that has received nothing, and lists orders by status", async () => {
    const w = await h.stocked();
    const po = await order(w, 10);
    await w.mgr.call("POST", `/api/purchase-orders/${po.id}/send`);
    expect((await w.mgr.call("POST", `/api/purchase-orders/${po.id}/cancel`)).json.status).toBe("cancelled");
    expect((await w.mgr.call("GET", "/api/purchase-orders?status=cancelled")).json).toHaveLength(1);
    expect((await w.mgr.call("GET", "/api/purchase-orders?status=draft")).json).toHaveLength(0);
  });

  it("builds draft orders from the low-stock list, one per default supplier, and reports items with no supplier", async () => {
    const w = await h.stocked({ qty: 2 });
    const sup2 = (await w.mgr.call("POST", "/api/suppliers", { name: "Second supplier" })).json;
    await w.mgr.call("PATCH", `/api/items/${w.item.id}`, { minQty: 10, reorderQty: 40, defaultSupplierId: w.sup.id });
    const other = (await w.mgr.call("POST", "/api/items", { genericName: "Zzbandage", unit: "roll", minQty: 5, defaultSupplierId: sup2.id })).json;
    const orphan = (await w.mgr.call("POST", "/api/items", { genericName: "Qqorphan", unit: "box", minQty: 3 })).json;
    const r = await w.mgr.call("POST", "/api/purchase-orders/from-low-stock", { storeId: w.f.storeId });
    expect(r.status).toBe(201);
    expect(r.json.created).toHaveLength(2);
    expect(r.json.skipped).toEqual([{ itemId: orphan.id, name: "Qqorphan", reason: "No default supplier set" }]);
    const orders = (await w.mgr.call("GET", "/api/purchase-orders?status=draft")).json;
    expect(orders).toHaveLength(2);
    const first = (await w.mgr.call("GET", `/api/purchase-orders/${orders.find((o: { supplierId: string }) => o.supplierId === w.sup.id).id}`)).json;
    expect(first.lines[0]).toMatchObject({ itemId: w.item.id, orderedQty: 40 });         // the larger of reorder qty and twice the minimum less stock
    expect(other.id).toBeTruthy();
  });

  it("another tenant cannot see, send, receive against or reference this tenant's orders, suppliers or lines", async () => {
    const a = await h.stocked();
    const b = await h.stocked();
    const po = await order(a);
    await a.mgr.call("POST", `/api/purchase-orders/${po.id}/send`);
    expect((await b.mgr.call("GET", `/api/purchase-orders/${po.id}`)).status).toBe(404);
    expect((await b.mgr.call("POST", `/api/purchase-orders/${po.id}/send`)).status).toBe(404);
    expect((await b.mgr.call("POST", `/api/purchase-orders/${po.id}/receive`, { lines: [{ poLineId: po.lines[0].id, quantity: 1, batchNo: "X", expiryDate: days(100) }] })).status).toBe(404);
    expect(JSON.stringify((await b.mgr.call("GET", "/api/purchase-orders")).json)).not.toContain(po.id);
    expect((await b.mgr.call("POST", "/api/purchase-orders", { supplierId: a.sup.id, storeId: b.f.storeId, lines: [{ itemId: b.item.id, quantity: 1 }] })).status).toBe(404);
    expect((await b.mgr.call("POST", "/api/purchase-orders", { supplierId: b.sup.id, storeId: b.f.storeId, lines: [{ itemId: a.item.id, quantity: 1 }] })).status).toBe(404);
  });
});
