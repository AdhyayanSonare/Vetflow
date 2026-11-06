import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../db/migrations");

export type MigrateOptions = {
  /** Connection string for an owner/superuser role that may create roles and tables. */
  adminUrl: string;
  /** Password for the vetflow_app login role. */
  appPassword?: string;
};

/**
 * Applies db/migrations/*.sql in order. Each applied file is recorded with a SHA-256 checksum.
 * If a file that was already applied has changed, this throws: applied migrations are immutable.
 */
export async function migrate(opts: MigrateOptions): Promise<string[]> {
  const client = new pg.Client({ connectionString: opts.adminUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`);
    const done = new Map<string, string>(
      (await client.query("select name, checksum from schema_migrations")).rows.map(r => [r.name, r.checksum])
    );
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
      const prior = done.get(file);
      if (prior) {
        if (prior !== checksum) throw new Error(`Migration ${file} was changed after it was applied`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
        applied.push(file);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
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
