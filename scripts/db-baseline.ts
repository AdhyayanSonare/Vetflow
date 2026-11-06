import "dotenv/config";
import pg from "pg";
import { poolConfig } from "../server/config/database";
import { getConfig } from "../server/config/env";
import { migrate, readMigrations } from "../server/db/migrate";
import { diffSignatures, schemaSignature } from "../server/db/signature";
import { startEmbedded } from "./lib/embedded";

/**
 * For a database whose tables were created by hand (for example by pasting the SQL into a hosted
 * dashboard). Builds a reference copy by running every migration on a throwaway PostgreSQL, compares
 * the two schemas object by object, and only if they match records the migrations as applied.
 *   pnpm db:baseline          compare and report
 *   pnpm db:baseline --yes    compare, and record the history if the schemas match
 *   --through 0009            compare and record only migrations up to that number, then run db:migrate for the rest
 *   --force                   record even if there are mismatches (review the report first)
 */
const argv = process.argv.slice(2);
const write = argv.includes("--yes");
const force = argv.includes("--force");
const through = argv.includes("--through") ? argv[argv.indexOf("--through") + 1] : undefined;
const config = getConfig();
if (!config.adminDatabaseUrl) {
  console.error("Set ADMIN_DATABASE_URL in .env first. See .env.example.");
  process.exit(2);
}

console.log("Building a reference schema on a temporary PostgreSQL...");
const ref = await startEmbedded({ port: 54331, persistent: false });
let exit = 0;
try {
  await migrate({ adminUrl: ref.adminUrl, through });
  const refClient = new pg.Client({ connectionString: ref.adminUrl });
  await refClient.connect();
  const expected = await schemaSignature(refClient);
  await refClient.end();

  const target = new pg.Client(poolConfig(config.adminDatabaseUrl, config.databaseCaCert));
  await target.connect();
  const actual = await schemaSignature(target);
  const diffs = diffSignatures(expected, actual);
  const bad = diffs.filter(d => d.kind !== "extra");
  const extra = diffs.filter(d => d.kind === "extra");

  for (const d of diffs) {
    const detail = d.kind === "different" ? `\n      expected: ${d.expected}\n      actual:   ${d.actual}` : d.kind === "missing" ? `\n      expected: ${d.expected}` : "";
    console.log(`  ${d.kind.toUpperCase().padEnd(9)} ${d.section}: ${d.key}${detail}`);
  }
  console.log(`\nCompared ${Object.values(expected).reduce((n, m) => n + m.size, 0)} schema objects: ${bad.length} mismatch(es), ${extra.length} extra object(s) in the target.`);

  if (bad.length && !(force && write)) {
    console.log("The target schema does not match the migrations, so its history was NOT recorded.");
    exit = 1;
  } else if (!write) {
    console.log("The schemas match. Run `pnpm db:baseline --yes` to record the migration history.");
  } else {
    await target.query("create table if not exists schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())");
    if (bad.length) console.log(`WARNING: recording history despite ${bad.length} mismatch(es) because --force was given.`);
    for (const m of readMigrations(through)) {
      await target.query("insert into schema_migrations (name, checksum) values ($1, $2) on conflict (name) do nothing", [m.name, m.checksum]);
    }
    console.log(`Recorded ${readMigrations(through).length} migrations as applied. Future \`pnpm db:migrate\` runs will only apply new files.`);
  }
  await target.end();
} catch (e) {
  console.error("Baseline failed:", (e as Error).message);
  exit = 1;
} finally {
  await ref.stop();
}
process.exit(exit);
