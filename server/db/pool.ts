import pg from "pg";
import { poolConfig } from "../config/database";
import { getConfig } from "../config/env";

let pool: pg.Pool | null = null;

/** App pool. Must connect as the non-superuser app role so row-level security applies. */
export function getPool(url = getConfig().databaseUrl, caCert = getConfig().databaseCaCert): pg.Pool {
  if (!url) throw new Error("DATABASE_URL is not set. Set DATABASE_URL, or ADMIN_DATABASE_URL with APP_DB_PASSWORD. See .env.example.");
  if (!pool) pool = new pg.Pool({ ...poolConfig(url, caCert), max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs fn inside one transaction with the tenant set for row-level security.
 * set_config(..., true) is transaction-local, so the tenant never leaks to the next
 * caller that reuses the pooled connection.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (c: pg.PoolClient) => Promise<T>,
  p: pg.Pool = getPool()
): Promise<T> {
  if (!UUID.test(tenantId)) throw new Error("Invalid tenant id");
  const c = await p.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
