import type pg from "pg";

/** The in-transit store holds goods that have left one store and not yet reached the next. */
export async function transitStore(c: pg.PoolClient, tenantId: string): Promise<string> {
  const r = await c.query(
    `insert into stores (tenant_id, kind, name) values ($1,'transit','In transit')
     on conflict (tenant_id, name) do update set kind = 'transit' returning id`, [tenantId]);
  return r.rows[0].id;
}
