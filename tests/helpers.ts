import pg from "pg";

export const adminUrl = () => process.env.TEST_ADMIN_URL!;
export const appUrl = () => process.env.TEST_APP_URL!;

export type Fixture = {
  tenantId: string; branchId: string; storeId: string; userId: string; itemId: string;
};

/** Creates a tenant with a branch, store, user and item using the admin role (bypasses RLS). */
export async function createTenant(name: string): Promise<Fixture> {
  const c = new pg.Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    const t = (await c.query("insert into tenants (name) values ($1) returning id", [name])).rows[0].id;
    await c.query("insert into tenant_settings (tenant_id) values ($1)", [t]);
    const b = (await c.query("insert into branches (tenant_id, name) values ($1,'Main') returning id", [t])).rows[0].id;
    const s = (await c.query("insert into stores (tenant_id, branch_id, kind, name) values ($1,$2,'central',$3) returning id", [t, b, `${name} central`])).rows[0].id;
    const u = (await c.query(
      "insert into users (tenant_id, email, name, password_hash, role) values ($1,$2,'Test','x','admin') returning id",
      [t, `${name.toLowerCase().replace(/\W/g, "")}-${Date.now()}@example.test`])).rows[0].id;
    const i = (await c.query("insert into items (tenant_id, generic_name, unit) values ($1,'Amoxicillin','tablet') returning id", [t])).rows[0].id;
    return { tenantId: t, branchId: b, storeId: s, userId: u, itemId: i };
  } finally { await c.end(); }
}

import type { Express } from "express";
import type { Server } from "node:http";

/** Starts an Express app on an ephemeral port and returns a fetch helper that keeps cookies. */
export async function serve(app: Express) {
  const server: Server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const jar = new Map<string, string>();
  let csrf = "";
  const call = async (method: string, path: string, body?: unknown, opts: { csrf?: boolean; noCookie?: boolean; raw?: Buffer; contentType?: string } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", connection: "close" };
    if (!opts.noCookie && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (opts.csrf !== false && csrf && method !== "GET") headers["x-csrf-token"] = csrf;
    if (opts.raw) headers["content-type"] = opts.contentType ?? "application/octet-stream";
    const res = await fetch(base + path, { method, headers, body: opts.raw ? new Uint8Array(opts.raw) : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); v ? jar.set(kv.slice(0, i), v) : jar.delete(kv.slice(0, i)); }
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString("utf8");
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    if (json?.csrfToken) csrf = json.csrfToken;
    return { status: res.status, json, headers: res.headers, text, buf };
  };
  return { call, close: () => new Promise<void>(r => server.close(() => r())), clearCookies: () => { jar.clear(); csrf = ""; }, setCsrf: (v: string) => { csrf = v; } };
}
