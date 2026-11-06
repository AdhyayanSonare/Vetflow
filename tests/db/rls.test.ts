import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../../server/db/pool";
import { appUrl, createTenant, type Fixture } from "../helpers";

let a: Fixture, b: Fixture, pool: pg.Pool;
beforeAll(async () => {
  a = await createTenant("Alpha");
  b = await createTenant("Beta");
  pool = new pg.Pool({ connectionString: appUrl() });
});
afterAll(async () => { await pool.end(); });

describe("row-level security, queried as the app role", () => {
  it("the app role is not a superuser and cannot bypass RLS", async () => {
    const r = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("returns no rows when no tenant is set", async () => {
    const r = await pool.query("select count(*)::int n from items");
    expect(r.rows[0].n).toBe(0);
  });

  it("a tenant sees only its own rows on every tenant table", async () => {
    const tables = (await pool.query(
      `select table_name from information_schema.columns
       where table_schema='public' and column_name='tenant_id'`)).rows.map(r => r.table_name);
    expect(tables.length).toBeGreaterThan(20);
    for (const t of tables) {
      const n = await withTenant(a.tenantId, async c =>
        (await c.query(`select count(*)::int n from ${t} where tenant_id <> $1`, [a.tenantId])).rows[0].n, pool);
      expect(n, `table ${t} leaked rows`).toBe(0);
    }
  });

  it("cannot read another tenant's item by id", async () => {
    const r = await withTenant(a.tenantId, c => c.query("select id from items where id = $1", [b.itemId]), pool);
    expect(r.rowCount).toBe(0);
  });

  it("cannot insert a row for another tenant", async () => {
    await expect(withTenant(a.tenantId, c =>
      c.query("insert into suppliers (tenant_id, name) values ($1,'Evil')", [b.tenantId]), pool)).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const up = await withTenant(a.tenantId, c => c.query("update items set generic_name='x' where id=$1", [b.itemId]), pool);
    expect(up.rowCount).toBe(0);
    const del = await withTenant(a.tenantId, c => c.query("delete from items where id=$1", [b.itemId]), pool);
    expect(del.rowCount).toBe(0);
  });

  it("does not leak the tenant to the next pooled caller", async () => {
    const one = new pg.Pool({ connectionString: appUrl(), max: 1 });
    await withTenant(a.tenantId, c => c.query("select 1"), one);
    const r = await one.query("select count(*)::int n from items");
    expect(r.rows[0].n).toBe(0);
    await one.end();
  });

  it("rejects a malformed tenant id", async () => {
    await expect(withTenant("1' or '1'='1", c => c.query("select 1"), pool)).rejects.toThrow("Invalid tenant id");
  });

  it("auth_lookup returns one user and no other tenant data", async () => {
    const email = (await withTenant(a.tenantId, c => c.query("select email from users where tenant_id=$1", [a.tenantId]), pool)).rows[0].email;
    const r = await pool.query("select * from auth_lookup($1)", [email]);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].tenant_id).toBe(a.tenantId);
  });
});

describe("append-only tables", () => {
  it("blocks update and delete on the audit log, even for the tenant owner", async () => {
    await withTenant(a.tenantId, c => c.query(
      "insert into audit_log (tenant_id, action, entity) values ($1,'test','x')", [a.tenantId]), pool);
    await expect(withTenant(a.tenantId, c => c.query("update audit_log set action='y'"), pool)).rejects.toThrow();
    await expect(withTenant(a.tenantId, c => c.query("delete from audit_log"), pool)).rejects.toThrow();
  });
});
