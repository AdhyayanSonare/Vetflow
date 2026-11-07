import type { Express } from "express";
import type pg from "pg";
import { z } from "zod";
import { auditTx, ensureOwned, HttpError, route } from "../../http/route";
import { uuid, qty, reasonText } from "../../http/schemas";
import { postMovement, issueFefo, clientIdempotencyKey } from "../stock/ledger";

export function registerStockOperationRoutes(app: Express, pool: pg.Pool) {
  // Departments ----------------------------------------------------------------------
  app.get("/api/departments", route(pool, "catalogue.read", async ({ c }) =>
    (await c.query(`select id, name, branch_id "branchId" from departments order by name`)).rows));
  app.post("/api/departments", route(pool, "settings.manage", async ({ c, user, req }) => {
    const b = z.object({ branchId: uuid, name: z.string().trim().min(1).max(80) }).parse(req.body);
    await ensureOwned(c, "branches", [b.branchId]);
    const r = await c.query("insert into departments (tenant_id, branch_id, name) values ($1,$2,$3) returning id, name", [user.tenantId, b.branchId, b.name]);
    await auditTx(c, user, "department.create", "department", r.rows[0].id);
    return r.rows[0];
  }, 201));

  // Issue to a department and return to store -------------------------------------------
  app.post("/api/stock/issue", route(pool, "stock.issue", async ({ c, user, req }) => {
    const b = z.object({ itemId: uuid, storeId: uuid, quantity: qty, departmentId: uuid.nullish(), reason: reasonText }).parse(req.body);
    await ensureOwned(c, "items", [b.itemId]);
    await ensureOwned(c, "stores", [b.storeId]);
    await ensureOwned(c, "departments", [b.departmentId]);
    const ctl = (await c.query("select controlled from items where id = $1", [b.itemId])).rows[0];
    if (ctl?.controlled) throw new HttpError(409, "controlled_item", "Controlled medicines are only taken out through a dispense, which needs a second person to confirm.");
    const plan = await issueFefo(c, {
      tenantId: user.tenantId, type: "issue", itemId: b.itemId, storeId: b.storeId, quantity: b.quantity, userId: user.userId,
      reason: b.reason, reference: b.departmentId ? `dept:${b.departmentId}` : "issue", idempotencyKey: clientIdempotencyKey(user.userId, req.get("idempotency-key")),
    });
    await auditTx(c, user, "stock.issue", "item", b.itemId, { quantity: b.quantity, departmentId: b.departmentId }, b.reason);
    return { allocations: plan };
  }, 201));

  app.post("/api/stock/return", route(pool, "stock.issue", async ({ c, user, req }) => {
    const b = z.object({ itemId: uuid, batchId: uuid, fromStoreId: uuid, toStoreId: uuid, quantity: qty, reason: reasonText }).parse(req.body);
    if (b.fromStoreId === b.toStoreId) throw new HttpError(400, "invalid", "toStoreId: choose a different store");
    await ensureOwned(c, "items", [b.itemId]);
    await ensureOwned(c, "batches", [b.batchId]);
    await ensureOwned(c, "stores", [b.fromStoreId, b.toStoreId]);
    if ((await c.query("select controlled from items where id = $1", [b.itemId])).rows[0]?.controlled) throw new HttpError(409, "controlled_item", "Controlled medicines are only moved through a dispense, which needs a second person to confirm.");
    const id = await postMovement(c, {
      tenantId: user.tenantId, type: "return_to_store", itemId: b.itemId, batchId: b.batchId, quantity: b.quantity,
      fromStoreId: b.fromStoreId, toStoreId: b.toStoreId, userId: user.userId, reason: b.reason, reference: "return",
      idempotencyKey: clientIdempotencyKey(user.userId, req.get("idempotency-key")),
    });
    return { ledgerId: id };
  }, 201));
}
