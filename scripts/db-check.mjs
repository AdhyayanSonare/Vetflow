// Read-only database connectivity check. Verifies TLS against the CA in DATABASE_CA_CERT
// (default certs/prod-ca-2021.crt for Supabase). It never turns certificate checking off.
// Prints no passwords.
import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

const raw = process.env.ADMIN_DATABASE_URL || process.env.DATABASE_URL;
if (!raw) {
  console.error("Set ADMIN_DATABASE_URL (or DATABASE_URL) in .env first. See .env.example.");
  process.exit(2);
}
const url = new URL(raw);
const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
const caPath = process.env.DATABASE_CA_CERT || "certs/prod-ca-2021.crt";
const ssl = local ? false : { ca: fs.existsSync(caPath) ? fs.readFileSync(caPath, "utf8") : undefined, rejectUnauthorized: true };
url.search = "";

console.log(`user=${url.username} host=${url.hostname} port=${url.port || 5432} tls=${local ? "off (local)" : "verified"} ca=${ssl && ssl.ca ? caPath : "system store"}`);
const c = new pg.Client({ connectionString: url.toString(), ssl });
try {
  await c.connect();
  const r = await c.query(`select current_user cu, split_part(version(),' on ',1) v,
    (select rolsuper from pg_roles where rolname = current_user) su,
    (select rolbypassrls from pg_roles where rolname = current_user) bypass,
    (select rolcreaterole from pg_roles where rolname = current_user) createrole`);
  const x = r.rows[0];
  console.log(`connected as ${x.cu}: ${x.v}; superuser=${x.su} bypassrls=${x.bypass} createrole=${x.createrole}`);
  const e = await c.query("select name, installed_version from pg_available_extensions where name in ('pg_trgm','pgcrypto') order by name");
  console.log("extensions:", e.rows.map(r => `${r.name}${r.installed_version ? " (installed)" : " (available)"}`).join(", ") || "none");
  const t = await c.query("select count(*)::int n from information_schema.tables where table_schema = 'public'");
  console.log("tables in public:", t.rows[0].n);
  await c.end();
} catch (err) {
  console.error("connection failed:", err.message);
  process.exit(1);
}
