import type { NextFunction, Request, Response } from "express";
import type pg from "pg";
import { ZodError } from "zod";
import { apiError } from "./errors";
import { can, type Permission } from "../modules/auth/permissions";
import type { SessionUser } from "../modules/auth/service";
import { withTenant } from "../db/pool";
import { StockError } from "../modules/stock/ledger";

export type Ctx = { c: pg.PoolClient; user: SessionUser; req: Request; res: Response };

/**
 * Wraps a route: checks sign-in and permission, runs the handler in one tenant transaction,
 * and maps validation and stock errors to clear API errors.
 */
export function route(
  pool: pg.Pool, perm: Permission | null, fn: (ctx: Ctx) => Promise<unknown>, okStatus = 200
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return apiError(res, 401, "unauthenticated", "Sign in to continue.");
    if (perm && !can(user.role, perm)) return apiError(res, 403, "forbidden", "Your role does not allow this action.");
    try {
      const out = await withTenant(user.tenantId, c => fn({ c, user, req, res }), pool);
      if (!res.headersSent) res.status(okStatus).json(out);
    } catch (e) {
      if (e instanceof ZodError) {
        const first = e.issues[0];
        return apiError(res, 400, "invalid", `${first?.path.join(".") || "Request"}: ${first?.message ?? "is not valid"}`);
      }
      if (e instanceof HttpError) return apiError(res, e.status, e.code, e.message, e.extra);
      if (e instanceof StockError) {
        const status = e.code === "forbidden" ? 403 : e.code === "invalid" ? 422 : 409;
        return apiError(res, status, e.code, e.message);
      }
      next(e);
    }
  };
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export const notFound = (what = "Record") => new HttpError(404, "not_found", `${what} not found.`);

const TABLES = new Set([
  "items", "suppliers", "stores", "batches", "categories", "animals", "owners", "consultations",
  "prescriptions", "branches", "users", "attachments", "departments",
]);

/**
 * Foreign keys are checked by the database without row-level security, so a client could otherwise
 * reference another tenant's id. Call this for every id that comes from a request body.
 */
export async function ensureOwned(c: pg.PoolClient, table: string, ids: Array<string | null | undefined>) {
  if (!TABLES.has(table)) throw new Error(`ensureOwned: unknown table ${table}`);
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return;
  const r = await c.query(`select count(*)::int n from ${table} where id = any($1::uuid[])`, [wanted]);
  if (r.rows[0].n !== wanted.length) throw notFound(table.replace(/s$/, ""));
}

export { can };

/** Audit entry written inside the caller's transaction, so it commits or rolls back with the change. */
export async function auditTx(
  c: pg.PoolClient, u: SessionUser, action: string, entity: string, entityId?: string, after?: unknown, reason?: string
) {
  await c.query(
    "insert into audit_log (tenant_id,user_id,action,entity,entity_id,after,reason) values ($1,$2,$3,$4,$5,$6,$7)",
    [u.tenantId, u.userId, action, entity, entityId ?? null, after ? JSON.stringify(after) : null, reason ?? null]);
}
