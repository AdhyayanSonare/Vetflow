import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { applyReceiptToOrder } from "./orders";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { uuid, date, qtyNum, paise } from "../../http/schemas";
import { confirmReceipt } from "../stock/ledger";
import { can } from "../auth/permissions";

export function registerPurchasingRoutes(app: Express, pool: pg.Pool) {
  // Receipts (purchase entries) ------------------------------------------------
  const ReceiptBody = z.object({
    supplierId: uuid, storeId: uuid, invoiceNo: z.string().trim().max(60).nullish(), invoiceDate: date.nullish(),
    taxPaise: paise.default(0), discountPaise: paise.default(0), attachmentId: uuid.nullish(),
    lines: z.array(z.object({
      itemId: uuid, batchNo: z.string().trim().min(1).max(60), expiryDate: date, mfgDate: date.nullish(),
      quantity: qtyNum, unitCostPaise: paise,
    })).min(1, "Add at least one line").max(500),
  });
  const receiptView = async (c: pg.PoolClient, id: string) => {
    const r = (await c.query(
      `select r.id, r.supplier_id "supplierId", s.name "supplierName", r.store_id "storeId", r.invoice_no "invoiceNo",
              r.invoice_date "invoiceDate", r.status, r.tax_paise::float "taxPaise", r.discount_paise::float "discountPaise",
              r.created_at "createdAt", r.confirmed_at "confirmedAt", r.attachment_id "attachmentId", r.po_id "poId"
         from purchase_receipts r join suppliers s on s.id = r.supplier_id where r.id = $1`, [id])).rows[0];
    if (!r) throw notFound("Receipt");
    r.lines = (await c.query(
      `select l.id, l.item_id "itemId", i.generic_name "itemName", l.batch_no "batchNo", l.expiry_date "expiryDate",
              l.mfg_date "mfgDate", l.quantity::float quantity, l.unit_cost_paise::float "unitCostPaise"
         from receipt_lines l join items i on i.id = l.item_id where l.receipt_id = $1 order by l.id`, [id])).rows;
    return r;
  };
  app.get("/api/receipts", route(pool, "purchase.write", async ({ c, req }) =>
    (await c.query(
      `select r.id, s.name "supplierName", r.invoice_no "invoiceNo", r.status, r.created_at "createdAt",
              (select count(*)::int from receipt_lines l where l.receipt_id = r.id) "lineCount"
         from purchase_receipts r join suppliers s on s.id = r.supplier_id
        where ($1::text is null or r.status = $1) order by r.created_at desc limit 200`, [req.query.status ?? null])).rows));
  app.get("/api/receipts/:id", route(pool, "purchase.write", ({ c, req }) => receiptView(c, uuid.parse(req.params.id))));
  app.post("/api/receipts", route(pool, "purchase.write", async ({ c, user, req }) => {
    const b = ReceiptBody.parse(req.body);
    await ensureOwned(c, "suppliers", [b.supplierId]);
    await ensureOwned(c, "stores", [b.storeId]);
    await ensureOwned(c, "items", b.lines.map(l => l.itemId));
    await ensureOwned(c, "attachments", [b.attachmentId]);
    const r = await c.query(
      `insert into purchase_receipts (tenant_id, supplier_id, store_id, invoice_no, invoice_date, tax_paise, discount_paise, attachment_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [user.tenantId, b.supplierId, b.storeId, b.invoiceNo ?? null, b.invoiceDate ?? null, b.taxPaise, b.discountPaise, b.attachmentId ?? null, user.userId]);
    for (const l of b.lines) {
      await c.query(
        `insert into receipt_lines (tenant_id, receipt_id, item_id, batch_no, expiry_date, mfg_date, quantity, unit_cost_paise)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [user.tenantId, r.rows[0].id, l.itemId, l.batchNo, l.expiryDate, l.mfgDate ?? null, l.quantity, l.unitCostPaise]);
    }
    await auditTx(c, user, "receipt.create", "purchase_receipt", r.rows[0].id);
    return receiptView(c, r.rows[0].id);
  }, 201));
  app.post("/api/receipts/:id/confirm", route(pool, "purchase.confirm", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    await receiptView(c, id);
    const done = await confirmReceipt(c, user.tenantId, id, user.userId);
    if (!done.alreadyConfirmed) await applyReceiptToOrder(c, id);
    return receiptView(c, id);
  }));
  app.delete("/api/receipts/:id", route(pool, "purchase.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const r = await c.query("update purchase_receipts set status='cancelled' where id=$1 and status='draft' returning id", [id]);
    if (!r.rowCount) throw new HttpError(409, "invalid", "Only a draft receipt can be cancelled.");
    await auditTx(c, user, "receipt.cancel", "purchase_receipt", id);
    return { ok: true };
  }));
}
