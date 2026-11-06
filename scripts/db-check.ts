import "dotenv/config";
import pg from "pg";
import { poolConfig } from "../server/config/database";
import { getConfig } from "../server/config/env";

/**
 * Read-only check of the configured database: connects as the owner and as the app role with
 * verified TLS, and confirms the security properties the app relies on. Prints no passwords.
 */
const config = getConfig();
let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failed++; };

async function connect(url: string | undefined, label: string) {
  if (!url) { console.error(`${label}: not configured. See .env.example.`); process.exit(2); }
  const u = new URL(url);
  console.log(`${label}: user=${u.username} host=${u.hostname} port=${u.port || 5432}`);
  const c = new pg.Client(poolConfig(url, config.databaseCaCert));
  try { await c.connect(); } catch (e) { console.error(`${label}: connection failed: ${(e as Error).message}`); process.exit(1); }
  return c;
}

const admin = await connect(config.adminDatabaseUrl, "owner role");
const a = (await admin.query("select version() v, (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) bypass")).rows[0];
ok(!!a.bypass, `owner can read across tenants (${String(a.v).split(" on ")[0]})`);
const hist = (await admin.query("select count(*)::int n from schema_migrations")).rows[0].n;
const files = (await import("../server/db/migrate")).readMigrations().length;
ok(hist === files, `all ${files} migrations are recorded (${hist} in the database)`);
await admin.end();

const app = await connect(config.databaseUrl, "app role");
const r = (await app.query(`select current_user cu,
  (select rolsuper from pg_roles where rolname = current_user) su, (select rolbypassrls from pg_roles where rolname = current_user) bypass,
  has_table_privilege(current_user, 'stock_ledger', 'UPDATE') upd_ledger, has_table_privilege(current_user, 'stock_ledger', 'DELETE') del_ledger,
  has_table_privilege(current_user, 'audit_log', 'UPDATE') upd_audit, has_table_privilege(current_user, 'stock_balances', 'UPDATE') upd_bal,
  has_table_privilege(current_user, 'items', 'INSERT') ins_items, has_table_privilege(current_user, 'vial_draws', 'INSERT') ins_vial,
  has_table_privilege(current_user, 'purchase_orders', 'INSERT') ins_po`)).rows[0];
ok(!r.su && !r.bypass, "app role is not a superuser and cannot bypass row-level security");
ok(!r.upd_ledger && !r.del_ledger, "app role cannot change or delete ledger rows");
ok(!r.upd_audit, "app role cannot change audit rows");
ok(!r.upd_bal, "app role cannot write stock balances directly");
ok(r.ins_items && r.ins_vial && r.ins_po, "app role can write the tables it needs (items, vial_draws, purchase_orders)");
const noTenant = (await app.query("select (select count(*) from items)::int items, (select count(*) from users)::int users")).rows[0];
ok(noTenant.items === 0 && noTenant.users === 0, "with no tenant set the app role sees no rows");
const sec = (await app.query("select count(*) filter (where not relforcerowsecurity)::int unforced from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'")).rows[0];
ok(sec.unforced === 0, "row-level security is forced on every tenant table");
await app.end();

console.log(failed ? `\n${failed} check(s) failed.` : "\nDatabase is ready.");
process.exit(failed ? 1 : 0);
