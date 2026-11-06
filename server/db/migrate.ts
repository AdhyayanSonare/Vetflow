import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { poolConfig } from "../config/database";

/** From source it is ../../db/migrations. From the bundle in dist/ it is ../db/migrations. */
const MIGRATIONS_DIR = [
  path.resolve(import.meta.dirname, "../../db/migrations"),
  path.resolve(import.meta.dirname, "../db/migrations"),
  path.resolve(process.cwd(), "db/migrations"),
].find(d => existsSync(d)) ?? path.resolve(process.cwd(), "db/migrations");

export type MigrationFile = { name: string; sql: string; checksum: string };

/**
 * The migration files in order, with the checksum that is stored when each is applied.
 * `through` limits the list to files up to that number, for example "0009".
 */
export function readMigrations(through?: string): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql") && (!through || f.slice(0, through.length) <= through)).sort().map(name => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    // Line endings are normalised so a checkout with CRLF on Windows gives the same checksum as one with LF.
    return { name, sql, checksum: createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex") };
  });
}

export type MigrateOptions = {
  /** Connection string for an owner/superuser role that may create roles and tables. */
  adminUrl: string;
  /** Password for the vetflow_app login role. */
  appPassword?: string;
  /** CA certificate file for a hosted database. Certificates are always verified. */
  caCert?: string;
  /** Apply only migrations up to this number, for example "0009". */
  through?: string;
};

/**
 * Applies db/migrations/*.sql in order. Each applied file is recorded with a SHA-256 checksum.
 * If a file that was already applied has changed, this throws: applied migrations are immutable.
 */
export async function migrate(opts: MigrateOptions): Promise<string[]> {
  const client = new pg.Client(poolConfig(opts.adminUrl, opts.caCert));
  await client.connect();
  const applied: string[] = [];
  try {
    const me = (await client.query("select rolsuper or rolbypassrls ok, current_user u from pg_roles where rolname = current_user")).rows[0];
    if (!me?.ok) {
      throw new Error(`Migrations must run as a role that is a superuser or has BYPASSRLS (the SECURITY DEFINER functions read across tenants). "${me?.u}" is neither.`);
    }
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const done = new Map<string, string>(
      (await client.query("select name, checksum from schema_migrations")).rows.map(r => [r.name, r.checksum])
    );
    for (const { name, sql, checksum } of readMigrations(opts.through)) {
      const prior = done.get(name);
      if (prior) {
        if (prior !== checksum) throw new Error(`Migration ${name} was changed after it was applied`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [name, checksum]);
        await client.query("commit");
        applied.push(name);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`, { cause: err });
      }
    }
    if (opts.appPassword) {
      // Role passwords are cluster settings, so they are set here and not in a migration file.
      await client.query(`alter role vetflow_app password ${pg.escapeLiteral(opts.appPassword)}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}
