import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { confirmReceipt, postMovement, suggestFefo } from "../ledger";
import { auditTx, ensureOwned, HttpError, notFound, route } from "./helpers";

const uuid = z.string().uuid();
const qtyNum = z.coerce.number().positive().max(1_000_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const paise = z.coerce.number().int().min(0).max(100_000_000_00);

const ItemBody = z.object({
  genericName: z.string().trim().min(1).max(200),
  brandName: z.string().trim().max(200).nullish(),
  strength: z.string().trim().max(60).nullish(),
  unit: z.string().trim().min(1).max(30),
  manufacturer: z.string().trim().max(200).nullish(),
  categoryId: uuid.nullish(),
  defaultSupplierId: uuid.nullish(),
  minQty: z.coerce.number().min(0).default(0),
  reorderQty: z.coerce.number().min(0).default(0),
  storageLocation: z.string().trim().max(100).nullish(),
  barcode: z.string().trim().max(64).nullish(),
  multiDose: z.boolean().default(false),
  doseVolumeMl: z.coerce.number().positive().nullish(),
  beyondUseDays: z.coerce.number().int().positive().nullish(),
  controlled: z.boolean().default(false),
  active: z.boolean().default(true),
});

/** For PATCH: every field optional and no defaults, so unspecified fields are never reset. */
const ItemPatch = z.object({
  genericName: ItemBody.shape.genericName, brandName: ItemBody.shape.brandName, strength: ItemBody.shape.strength,
  unit: ItemBody.shape.unit, manufacturer: ItemBody.shape.manufacturer, categoryId: ItemBody.shape.categoryId,
  defaultSupplierId: ItemBody.shape.defaultSupplierId, minQty: z.coerce.number().min(0), reorderQty: z.coerce.number().min(0),
  storageLocation: ItemBody.shape.storageLocation, barcode: ItemBody.shape.barcode, multiDose: z.boolean(),
  doseVolumeMl: ItemBody.shape.doseVolumeMl, beyondUseDays: ItemBody.shape.beyondUseDays, controlled: z.boolean(), active: z.boolean(),
}).partial();

const itemSelect = `i.id, i.code, i.generic_name "genericName", i.brand_name "brandName", i.strength, i.unit,
  i.manufacturer, i.category_id "categoryId", i.default_supplier_id "defaultSupplierId",
  i.min_qty::float "minQty", i.reorder_qty::float "reorderQty", i.storage_location "storageLocation",
  i.barcode, i.multi_dose "multiDose", i.dose_volume_ml::float "doseVolumeMl", i.beyond_use_days "beyondUseDays",
  i.controlled, i.active`;

export function registerInventoryRoutes(app: Express, pool: pg.Pool) {
  // Branches and stores ------------------------------------------------------
  app.get("/api/branches", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query("select id, name, active from branches order by name")).rows));
  app.get("/api/stores", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query(`select id, name, kind, branch_id "branchId", active from stores where kind <> 'transit' order by name`)).rows));

  // Categories ---------------------------------------------------------------
  app.get("/api/categories", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query("select id, name from categories order by name")).rows));
  app.post("/api/categories", route(pool, "catalogue.write", async ({ c, user, req }) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const r = await c.query("insert into categories (tenant_id, name) values ($1,$2) on conflict (tenant_id, name) do update set name = excluded.name returning id, name",
      [user.tenantId, name]);
    return r.rows[0];
  }, 201));

  // Items --------------------------------------------------------------------
  app.get("/api/items", route(pool, "catalogue.read", async ({ c, req }) => {
    const q = String(req.query.q ?? "").trim();
    const storeId = req.query.storeId ? uuid.parse(req.query.storeId) : null;
    const includeInactive = req.query.includeInactive === "true";
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
    const r = await c.query(
      `select ${itemSelect}, coalesce(sum(sb.quantity) filter (where $2::uuid is null or sb.store_id = $2), 0)::float "onHand"
         from items i left join stock_balances sb on sb.item_id = i.id
        where ($3 or i.active)
          and ($1 = '' or i.generic_name ilike '%' || $1 || '%' or i.brand_name ilike '%' || $1 || '%'
               or i.code ilike $1 || '%' or i.barcode = $1 or i.generic_name % $1 or i.brand_name % $1)
        group by i.id
        order by case when $1 = '' then 0 else -greatest(similarity(i.generic_name, $1), similarity(coalesce(i.brand_name,''), $1)) end, i.generic_name
        limit $4 offset $5`, [q, storeId, includeInactive, limit, offset]);
    return r.rows;
  }));

  app.get("/api/items/:id", route(pool, "catalogue.read", async ({ c, req }) => {
    const r = await c.query(`select ${itemSelect} from items i where i.id = $1`, [uuid.parse(req.params.id)]);
    if (!r.rows[0]) throw notFound("Item");
    return r.rows[0];
  }));

  app.post("/api/items", route(pool, "catalogue.write", async ({ c, user, req }) => {
    const b = ItemBody.parse(req.body);
    await ensureOwned(c, "categories", [b.categoryId]);
    await ensureOwned(c, "suppliers", [b.defaultSupplierId]);
    if (b.multiDose && !b.doseVolumeMl) throw new HttpError(400, "invalid", "A multi-dose item needs a container volume in ml.");
    // Warn about near-duplicates unless the user has confirmed.
    if (req.body?.confirmSimilar !== true) {
      const sim = await c.query(
        `select id, code, generic_name "genericName", strength, unit, similarity(generic_name, $1)::float score
           from items where similarity(generic_name, $1) > 0.5 order by score desc limit 5`, [b.genericName]);
      if (sim.rows.length) {
        const exact = sim.rows.find(s => s.genericName.toLowerCase() === b.genericName.toLowerCase()
          && (s.strength ?? "") === (b.strength ?? "") && s.unit === b.unit);
        throw new HttpError(409, "similar_items",
          exact ? "An item with the same name, strength and unit already exists." : "Similar items already exist. Check them, then confirm to add anyway.",
          { similar: sim.rows, exact: !!exact });
      }
    }
    try {
      const r = await c.query(
        `insert into items (tenant_id, generic_name, brand_name, strength, unit, manufacturer, category_id, default_supplier_id,
           min_qty, reorder_qty, storage_location, barcode, multi_dose, dose_volume_ml, beyond_use_days, controlled, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
        [user.tenantId, b.genericName, b.brandName ?? null, b.strength ?? null, b.unit, b.manufacturer ?? null, b.categoryId ?? null,
          b.defaultSupplierId ?? null, b.minQty, b.reorderQty, b.storageLocation ?? null, b.barcode || null, b.multiDose,
          b.doseVolumeMl ?? null, b.beyondUseDays ?? null, b.controlled, b.active]);
      await auditTx(c, user, "item.create", "item", r.rows[0].id, { genericName: b.genericName });
      return (await c.query(`select ${itemSelect} from items i where i.id = $1`, [r.rows[0].id])).rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "duplicate_barcode", "Another item already uses this barcode.");
      throw e;
    }
  }, 201));

  app.patch("/api/items/:id", route(pool, "catalogue.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = ItemPatch.parse(req.body);
    await ensureOwned(c, "categories", [b.categoryId]);
    await ensureOwned(c, "suppliers", [b.defaultSupplierId]);
    const cols: Record<string, string> = {
      genericName: "generic_name", brandName: "brand_name", strength: "strength", unit: "unit", manufacturer: "manufacturer",
      categoryId: "category_id", defaultSupplierId: "default_supplier_id", minQty: "min_qty", reorderQty: "reorder_qty",
      storageLocation: "storage_location", barcode: "barcode", multiDose: "multi_dose", doseVolumeMl: "dose_volume_ml",
      beyondUseDays: "beyond_use_days", controlled: "controlled", active: "active",
    };
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined || !cols[k]) continue;
      vals.push(k === "barcode" ? (v || null) : v);
      sets.push(`${cols[k]} = $${vals.length}`);
    }
    if (!sets.length) throw new HttpError(400, "invalid", "Nothing to change.");
    const before = (await c.query("select * from items where id = $1", [id])).rows[0];
    if (!before) throw notFound("Item");
    try { await c.query(`update items set ${sets.join(", ")} where id = $1`, vals); }
    catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "duplicate_barcode", "Another item already uses this barcode.");
      throw e;
    }
    await auditTx(c, user, "item.update", "item", id, b);
    return (await c.query(`select ${itemSelect} from items i where i.id = $1`, [id])).rows[0];
  }));

  // Suppliers ----------------------------------------------------------------
  const SupplierBody = z.object({
    name: z.string().trim().min(1).max(200), contactName: z.string().trim().max(120).nullish(),
    phone: z.string().trim().max(40).nullish(), email: z.string().trim().email().nullish().or(z.literal("")),
    address: z.string().trim().max(400).nullish(),
    gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, "GSTIN has 15 characters").nullish().or(z.literal("")),
    paymentTerms: z.string().trim().max(120).nullish(), outstandingPaise: paise.optional(),
  });
  const supplierSelect = `id, name, contact_name "contactName", phone, email, address, gstin, payment_terms "paymentTerms",
    outstanding_paise::float "outstandingPaise", active`;
  app.get("/api/suppliers", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query(`select ${supplierSelect} from suppliers order by name`)).rows));
  app.post("/api/suppliers", route(pool, "suppliers.write", async ({ c, user, req }) => {
    const b = SupplierBody.parse(req.body);
    try {
      const r = await c.query(
        `insert into suppliers (tenant_id,name,contact_name,phone,email,address,gstin,payment_terms,outstanding_paise)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${supplierSelect}`,
        [user.tenantId, b.name, b.contactName ?? null, b.phone ?? null, b.email || null, b.address ?? null, b.gstin || null,
          b.paymentTerms ?? null, b.outstandingPaise ?? 0]);
      await auditTx(c, user, "supplier.create", "supplier", r.rows[0].id, { name: b.name });
      return r.rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "duplicate", "A supplier with this name already exists.");
      throw e;
    }
  }, 201));
  app.patch("/api/suppliers/:id", route(pool, "suppliers.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const b = SupplierBody.partial().parse(req.body);
    const r = await c.query(
      `update suppliers set name = coalesce($2,name), contact_name = coalesce($3,contact_name), phone = coalesce($4,phone),
         email = coalesce($5,email), address = coalesce($6,address), gstin = coalesce($7,gstin),
         payment_terms = coalesce($8,payment_terms), outstanding_paise = coalesce($9,outstanding_paise)
       where id = $1 returning ${supplierSelect}`,
      [id, b.name ?? null, b.contactName ?? null, b.phone ?? null, b.email || null, b.address ?? null, b.gstin || null,
        b.paymentTerms ?? null, b.outstandingPaise ?? null]);
    if (!r.rows[0]) throw notFound("Supplier");
    await auditTx(c, user, "supplier.update", "supplier", id, b);
    return r.rows[0];
  }));
  app.get("/api/suppliers/:id/purchases", route(pool, "catalogue.read", async ({ c, req }) =>
    (await c.query(
      `select r.id, r.invoice_no "invoiceNo", r.invoice_date "invoiceDate", r.status, r.created_at "createdAt",
              coalesce(sum(l.quantity * l.unit_cost_paise),0)::float "subtotalPaise"
         from purchase_receipts r left join receipt_lines l on l.receipt_id = r.id
        where r.supplier_id = $1 group by r.id order by r.created_at desc limit 100`, [uuid.parse(req.params.id)])).rows));

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
              r.created_at "createdAt", r.confirmed_at "confirmedAt"
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
    await confirmReceipt(c, user.tenantId, id, user.userId);
    return receiptView(c, id);
  }));
  app.delete("/api/receipts/:id", route(pool, "purchase.write", async ({ c, user, req }) => {
    const id = uuid.parse(req.params.id);
    const r = await c.query("update purchase_receipts set status='cancelled' where id=$1 and status='draft' returning id", [id]);
    if (!r.rowCount) throw new HttpError(409, "invalid", "Only a draft receipt can be cancelled.");
    await auditTx(c, user, "receipt.cancel", "purchase_receipt", id);
    return { ok: true };
  }));

  // Stock views ----------------------------------------------------------------
  app.get("/api/stock", route(pool, "catalogue.read", async ({ c, req }) => {
    const itemId = req.query.itemId ? uuid.parse(req.query.itemId) : null;
    const storeId = req.query.storeId ? uuid.parse(req.query.storeId) : null;
    return (await c.query(
      `select sb.item_id "itemId", i.code, i.generic_name "itemName", i.unit, sb.batch_id "batchId", b.batch_no "batchNo",
              to_char(b.expiry_date,'YYYY-MM-DD') "expiryDate", (b.expiry_date < current_date) expired,
              sb.store_id "storeId", st.name "storeName", sb.quantity::float quantity, b.unit_cost_paise::float "unitCostPaise"
         from stock_balances sb join items i on i.id = sb.item_id join batches b on b.id = sb.batch_id join stores st on st.id = sb.store_id
        where sb.quantity <> 0 and ($1::uuid is null or sb.item_id = $1) and ($2::uuid is null or sb.store_id = $2)
        order by i.generic_name, b.expiry_date limit 1000`, [itemId, storeId])).rows;
  }));

  app.get("/api/stock/suggest", route(pool, "stock.issue", async ({ c, req }) => {
    const q = z.object({ itemId: uuid, storeId: uuid, quantity: qtyNum }).parse(req.query);
    return suggestFefo(c, q.itemId, q.storeId, q.quantity);
  }));

  app.get("/api/low-stock", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query(
      `select * from (
         select i.id "itemId", i.code, i.generic_name "itemName", i.unit, i.min_qty::float "minQty",
                coalesce(sum(sb.quantity),0)::float "onHand",
                greatest(i.reorder_qty, i.min_qty * 2 - coalesce(sum(sb.quantity),0))::float "suggestedReorder",
                i.default_supplier_id "supplierId"
           from items i left join stock_balances sb on sb.item_id = i.id
          where i.active group by i.id) t
       where "onHand" <= "minQty" and "minQty" > 0 order by "onHand" - "minQty", "itemName"`)).rows));

  app.get("/api/expiring", route(pool, "catalogue.read", async ({ c, req }) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 90) || 90, 1), 730);
    return (await c.query(
      `select i.id "itemId", i.generic_name "itemName", b.id "batchId", b.batch_no "batchNo", to_char(b.expiry_date,'YYYY-MM-DD') "expiryDate",
              (b.expiry_date - current_date) "daysLeft", sum(sb.quantity)::float quantity, (b.expiry_date < current_date) expired
         from stock_balances sb join batches b on b.id = sb.batch_id join items i on i.id = sb.item_id
        where sb.quantity > 0 and b.expiry_date <= current_date + $1::int
        group by i.id, b.id order by b.expiry_date`, [days])).rows;
  }));

  // Adjustments: damage, expiry write-off, supplier return, count correction ---------
  const AdjustBody = z.object({
    type: z.enum(["damage", "expiry_writeoff", "return_to_supplier", "count_adjustment"]),
    itemId: uuid, batchId: uuid, storeId: uuid, quantity: qtyNum,
    direction: z.enum(["increase", "decrease"]).optional(), reason: z.string().trim().min(3, "A reason is required").max(300),
    override: z.boolean().optional(),
  });
  app.post("/api/stock/adjust", route(pool, "stock.adjust", async ({ c, user, req }) => {
    const b = AdjustBody.parse(req.body);
    await ensureOwned(c, "items", [b.itemId]);
    await ensureOwned(c, "batches", [b.batchId]);
    await ensureOwned(c, "stores", [b.storeId]);
    if (b.type === "count_adjustment" && !b.direction) throw new HttpError(400, "invalid", "direction: choose increase or decrease");
    const adding = b.type === "count_adjustment" && b.direction === "increase";
    if (b.override && !(user.role === "admin" || user.role === "inventory_manager")) throw new HttpError(403, "forbidden", "Your role cannot override stock limits.");
    const id = await postMovement(c, {
      tenantId: user.tenantId, type: b.type, itemId: b.itemId, batchId: b.batchId, quantity: b.quantity,
      fromStoreId: adding ? null : b.storeId, toStoreId: adding ? b.storeId : null, userId: user.userId,
      reason: b.reason, reference: `adjust:${b.type}`, idempotencyKey: String(req.get("idempotency-key") ?? randomUUID()),
      override: b.override,
    });
    await auditTx(c, user, `stock.${b.type}`, "stock_ledger", id, { itemId: b.itemId, batchId: b.batchId, quantity: b.quantity }, b.reason);
    return { ledgerId: id };
  }, 201));

  app.get("/api/ledger", route(pool, "audit.read", async ({ c, req }) => {
    const itemId = req.query.itemId ? uuid.parse(req.query.itemId) : null;
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    return (await c.query(
      `select l.id, l.at, l.type, l.quantity::float quantity, i.generic_name "itemName", b.batch_no "batchNo",
              fs.name "fromStore", ts.name "toStore", u.name "userName", l.reason, l.reference, l.override
         from stock_ledger l join items i on i.id = l.item_id join batches b on b.id = l.batch_id
         left join stores fs on fs.id = l.from_store_id left join stores ts on ts.id = l.to_store_id left join users u on u.id = l.user_id
        where ($1::uuid is null or l.item_id = $1) order by l.id desc limit $2`, [itemId, limit])).rows;
  }));
}
