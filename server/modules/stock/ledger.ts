import type pg from "pg";

/**
 * Stock service. Every stock change goes through the SQL function apply_stock_movement,
 * inside the caller's transaction (see withTenant). Nothing else may write stock_balances.
 */
export type MovementType =
  | "opening" | "receipt" | "issue" | "dispense" | "transfer_out" | "transfer_in"
  | "return_to_store" | "return_to_supplier" | "damage" | "expiry_writeoff" | "count_adjustment";

export type Movement = {
  tenantId: string;
  type: MovementType;
  itemId: string;
  batchId: string;
  quantity: string | number;
  fromStoreId?: string | null;
  toStoreId?: string | null;
  userId?: string | null;
  reason?: string | null;
  reference?: string | null;
  idempotencyKey: string;
  override?: boolean;
};

export class StockError extends Error {
  constructor(public code: "insufficient" | "expired" | "invalid" | "forbidden", message: string) {
    super(message);
  }
}

function translate(err: unknown): never {
  const e = err as { message?: string; hint?: string; code?: string };
  if (e.hint === "insufficient") throw new StockError("insufficient", "Not enough stock in this batch");
  if (e.hint === "expired") throw new StockError("expired", "This batch has expired and cannot be issued");
  if (e.code === "42501") throw new StockError("forbidden", e.message ?? "Not permitted");
  if (e.code === "P0001" || e.code === "23514") throw new StockError("invalid", e.message ?? "Invalid movement");
  throw err;
}

/** Writes one ledger row and updates the balance. Returns the ledger id. Replays return the original id. */
export async function postMovement(c: pg.PoolClient, m: Movement): Promise<string> {
  await c.query("savepoint mv");
  try {
    const r = await c.query(
      "select apply_stock_movement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as id",
      [m.tenantId, m.type, m.itemId, m.batchId, m.quantity, m.fromStoreId ?? null, m.toStoreId ?? null,
        m.userId ?? null, m.reason ?? null, m.reference ?? null, m.idempotencyKey, m.override ?? false]
    );
    await c.query("release savepoint mv");
    return r.rows[0].id;
  } catch (err) {
    await c.query("rollback to savepoint mv");
    translate(err);
  }
}

export type Allocation = { batchId: string; batchNo: string; expiryDate: string; available: string; take: string };

/**
 * First-expiry-first-out suggestion. Skips expired batches. Returns the batches to draw from
 * and how much to take from each. Throws "insufficient" when the usable stock is too small.
 */
export async function suggestFefo(
  c: pg.PoolClient, itemId: string, storeId: string, quantity: string | number
): Promise<Allocation[]> {
  const rows = (await c.query(
    `select b.id, b.batch_no, to_char(b.expiry_date,'YYYY-MM-DD') as expiry, sb.quantity::text as available
       from stock_balances sb join batches b on b.id = sb.batch_id
      where sb.item_id = $1 and sb.store_id = $2 and sb.quantity > 0 and b.expiry_date >= today_ist()
      order by b.expiry_date, b.created_at, b.id`, [itemId, storeId])).rows;
  const out: Allocation[] = [];
  // Decimal arithmetic in thousandths avoids float drift.
  let need = Math.round(Number(quantity) * 1000);
  for (const r of rows) {
    if (need <= 0) break;
    const avail = Math.round(Number(r.available) * 1000);
    const take = Math.min(avail, need);
    out.push({ batchId: r.id, batchNo: r.batch_no, expiryDate: r.expiry, available: r.available, take: (take / 1000).toFixed(3) });
    need -= take;
  }
  if (need > 0) throw new StockError("insufficient", "Not enough unexpired stock for this item");
  return out;
}

/** Issues or dispenses by FEFO across batches. All rows commit together or none do. */
export async function issueFefo(
  c: pg.PoolClient,
  p: {
    tenantId: string; type: "issue" | "dispense"; itemId: string; storeId: string; quantity: string | number;
    userId: string; reason?: string; reference: string; idempotencyKey: string;
  }
): Promise<Allocation[]> {
  const plan = await suggestFefo(c, p.itemId, p.storeId, p.quantity);
  for (const a of plan) {
    await postMovement(c, {
      tenantId: p.tenantId, type: p.type, itemId: p.itemId, batchId: a.batchId, quantity: a.take,
      fromStoreId: p.storeId, userId: p.userId, reason: p.reason, reference: p.reference,
      idempotencyKey: `${p.idempotencyKey}:${a.batchId}`,
    });
  }
  return plan;
}

/**
 * Confirms a draft receipt: creates batches, posts one 'receipt' row per line, marks it confirmed.
 * Confirming twice is a no-op, so stock rises exactly once.
 */
export async function confirmReceipt(c: pg.PoolClient, tenantId: string, receiptId: string, userId: string) {
  const rc = (await c.query("select * from purchase_receipts where id = $1 for update", [receiptId])).rows[0];
  if (!rc) throw new StockError("invalid", "Receipt not found");
  if (rc.status === "confirmed") return { alreadyConfirmed: true };
  if (rc.status !== "draft") throw new StockError("invalid", "Only a draft receipt can be confirmed");
  const lines = (await c.query("select * from receipt_lines where receipt_id = $1 order by id", [receiptId])).rows;
  if (lines.length === 0) throw new StockError("invalid", "A receipt needs at least one line");
  for (const l of lines) {
    const batch = (await c.query(
      `insert into batches (tenant_id, item_id, batch_no, expiry_date, mfg_date, unit_cost_paise, supplier_id)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (tenant_id, item_id, batch_no, expiry_date) do update set unit_cost_paise = batches.unit_cost_paise
       returning id`,
      [tenantId, l.item_id, l.batch_no, l.expiry_date, l.mfg_date, l.unit_cost_paise, rc.supplier_id])).rows[0];
    await postMovement(c, {
      tenantId, type: "receipt", itemId: l.item_id, batchId: batch.id, quantity: l.quantity,
      toStoreId: rc.store_id, userId, reference: `receipt:${receiptId}`, idempotencyKey: `receipt:${l.id}`,
    });
  }
  await c.query("update purchase_receipts set status='confirmed', confirmed_by=$2, confirmed_at=now() where id=$1", [receiptId, userId]);
  await c.query(
    "insert into audit_log (tenant_id, user_id, action, entity, entity_id) values ($1,$2,'receipt.confirm','purchase_receipt',$3)",
    [tenantId, userId, receiptId]);
  return { alreadyConfirmed: false };
}

/**
 * Moves stock between stores. A transfer writes transfer_out and transfer_in rows and
 * never an issue or dispense, so it is not counted as consumption.
 */
export async function transferStock(
  c: pg.PoolClient,
  p: { tenantId: string; itemId: string; batchId: string; quantity: string | number; fromStoreId: string;
       toStoreId: string; userId: string; reference: string; idempotencyKey: string }
) {
  await postMovement(c, { tenantId: p.tenantId, type: "transfer_out", itemId: p.itemId, batchId: p.batchId,
    quantity: p.quantity, fromStoreId: p.fromStoreId, userId: p.userId, reference: p.reference,
    idempotencyKey: `${p.idempotencyKey}:out` });
  await postMovement(c, { tenantId: p.tenantId, type: "transfer_in", itemId: p.itemId, batchId: p.batchId,
    quantity: p.quantity, toStoreId: p.toStoreId, userId: p.userId, reference: p.reference,
    idempotencyKey: `${p.idempotencyKey}:in` });
}

/** Rows where the stored balance and the ledger disagree. Empty means they match. */
export async function reconcile(c: pg.PoolClient, tenantId: string) {
  return (await c.query("select * from reconcile_balances($1)", [tenantId])).rows;
}

/**
 * A key chosen by a client is namespaced per user so it can never equal a system key such as
 * `dispense:<id>:<item>` or `receipt:<line>`, and is capped in length. A client that sends none gets a fresh one.
 */
export function clientIdempotencyKey(userId: string, header: string | undefined): string {
  return header ? `client:${userId}:${header.slice(0, 100)}` : `client:${userId}:${crypto.randomUUID()}`;
}
