import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, notFound, route } from "../../http/route";
import { paise, uuid } from "../../http/schemas";

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

export function registerCatalogueRoutes(app: Express, pool: pg.Pool) {
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
}
