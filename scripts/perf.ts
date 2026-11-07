import http from "node:http";
import type { AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import pg from "pg";
import pino from "pino";
import { createApp } from "../server/app";
import { createClinic } from "../server/db/bootstrap";
import { migrate } from "../server/db/migrate";
import { startEmbedded } from "./lib/embedded";

/**
 * Performance gates, measured through the real HTTP API against a throwaway database:
 *   - item search p95 under 300 ms with 10,000 items
 *   - dashboard under 2 s with 500,000 ledger rows
 * Sizes can be lowered for a quick look: PERF_ITEMS=2000 PERF_LEDGER=50000 pnpm perf
 * The data is for timing only (balances are not derived from the generated ledger rows).
 */
const ITEMS = Number(process.env.PERF_ITEMS ?? 10_000);
const LEDGER = Number(process.env.PERF_LEDGER ?? 500_000);
const SEARCHES = Number(process.env.PERF_SEARCHES ?? 400);
const GATE_SEARCH_P95_MS = 300;
const GATE_DASHBOARD_MS = 2000;

const BASE = [
  "Amoxicillin", "Doxycycline", "Metronidazole", "Carprofen", "Meloxicam", "Cephalexin", "Enrofloxacin", "Prednisolone", "Furosemide", "Gabapentin",
  "Tramadol", "Ketamine", "Xylazine", "Ivermectin", "Fenbendazole", "Praziquantel", "Ondansetron", "Maropitant", "Famotidine", "Omeprazole",
  "Clindamycin", "Cefovecin", "Marbofloxacin", "Pimobendan", "Enalapril", "Benazepril", "Atenolol", "Diazepam", "Phenobarbital", "Levetiracetam",
  "Insulin glargine", "Dexamethasone", "Hydroxyzine", "Cetirizine", "Atipamezole", "Buprenorphine", "Butorphanol", "Propofol", "Lidocaine", "Bupivacaine",
  "Oxytetracycline", "Penicillin G", "Gentamicin", "Ceftiofur", "Tylosin", "Albendazole", "Levamisole", "Closantel", "Calcium borogluconate", "Vitamin B complex",
  "Dextrose", "Sodium chloride", "Ringer lactate", "Potassium chloride", "Heparin", "Vitamin K1", "Mannitol", "Acepromazine", "Medetomidine", "Isoflurane",
];

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
const ms = (n: number) => `${n.toFixed(1)} ms`;

async function seed(admin: pg.Pool, tenantId: string, branchStoreId: string, centralStoreId: string) {
  const c = await admin.connect();
  try {
    const t0 = performance.now();
    await c.query(
      `insert into items (tenant_id, generic_name, brand_name, strength, unit, min_qty, reorder_qty, barcode)
       select $1::uuid, ($2::text[])[1 + n % $3::int], 'Brand' || (n % 400),
              (25 + (n / $3::int) * 5) || ' mg', (array['tablet','ml','vial','capsule','sachet'])[1 + n % 5],
              20 + n % 50, 100, '89' || lpad(n::text, 11, '0')
         from generate_series(0, $4::int - 1) n`, [tenantId, BASE, BASE.length, ITEMS]);
    await c.query(
      `insert into batches (tenant_id, item_id, batch_no, expiry_date, unit_cost_paise)
       select $1::uuid, i.id, 'B' || k || '-' || row_number() over (), current_date + (30 + (random() * 700)::int), 100 + (random() * 5000)::int
         from items i cross join generate_series(1, 2) k where i.tenant_id = $1::uuid`, [tenantId]);
    await c.query(
      `insert into stock_balances (tenant_id, item_id, batch_id, store_id, quantity)
       select $1::uuid, b.item_id, b.id, s.id, 5 + (random() * 195)::int
         from batches b cross join (select unnest(array[$2::uuid, $3::uuid]) id) s where b.tenant_id = $1::uuid`, [tenantId, branchStoreId, centralStoreId]);
    await c.query("create temp table nb as select row_number() over () rn, id, item_id from batches where tenant_id = $1::uuid", [tenantId]);
    const nb = Number((await c.query("select count(*) n from nb")).rows[0].n);
    await c.query(
      `insert into stock_ledger (tenant_id, at, item_id, batch_id, type, quantity, from_store_id, to_store_id, reference, idempotency_key)
       select $1::uuid, now() - (random() * interval '365 days'), nb.item_id, nb.id,
              case when g % 10 = 0 then 'receipt' when g % 10 < 7 then 'dispense' else 'issue' end,
              1 + g % 20,
              case when g % 10 = 0 then null else $2::uuid end,
              case when g % 10 = 0 then $3::uuid else null end,
              'perf', 'perf-' || g
         from generate_series(1, $4::int) g join nb on nb.rn = 1 + (g::bigint * 7919) % $5::bigint`, [tenantId, branchStoreId, centralStoreId, LEDGER, nb]);
    await c.query("analyze");
    const counts = (await c.query(
      "select (select count(*) from items) items, (select count(*) from batches) batches, (select count(*) from stock_ledger) ledger")).rows[0];
    return { seconds: (performance.now() - t0) / 1000, ...counts };
  } finally {
    c.release();
  }
}

const db = await startEmbedded({ port: 54350, persistent: false });
const admin = new pg.Pool({ connectionString: db.adminUrl, max: 4 });
const app = new pg.Pool({ connectionString: db.appUrl, max: 10 });
let server: http.Server | undefined;
let failed = true; // stays true if anything throws before both gates have been checked
try {
  await migrate({ adminUrl: db.adminUrl, appPassword: "local_app_pw" });
  const clinic = await createClinic(admin, { clinicName: "Perf clinic", adminEmail: "perf@example.test", adminName: "Perf", password: "Perf-test-pass-1" });
  const stores = (await admin.query("select id, kind from stores where tenant_id = $1", [clinic.tenantId])).rows;
  const central = stores.find(s => s.kind === "central").id as string;
  const branch = stores.find(s => s.kind === "branch").id as string;

  console.log(`Loading ${ITEMS.toLocaleString()} items and ${LEDGER.toLocaleString()} ledger rows...`);
  const loaded = await seed(admin, clinic.tenantId, branch, central);
  console.log(`  loaded in ${loaded.seconds.toFixed(1)} s: ${loaded.items} items, ${loaded.batches} batches, ${loaded.ledger} ledger rows`);

  server = http.createServer(createApp(app, { logger: pino({ level: "silent" }) }));
  await new Promise<void>(r => server!.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: clinic.adminEmail, password: clinic.password }),
  });
  if (login.status !== 200) throw new Error(`Sign-in failed (${login.status})`);
  const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const get = async (path: string) => {
    const t = performance.now();
    const res = await fetch(base + path, { headers: { cookie } });
    const body = await res.json();
    if (res.status !== 200) throw new Error(`${path} -> ${res.status}`);
    return { ms: performance.now() - t, body };
  };

  // Item search: a realistic mix of exact names, prefixes, typos, brands, codes, barcodes and browsing.
  const terms: string[] = [];
  for (let i = 0; i < SEARCHES; i++) {
    const name = BASE[(i * 7) % BASE.length];
    switch (i % 8) {
      case 0: terms.push(name); break;
      case 1: terms.push(name.slice(0, 4).toLowerCase()); break;
      case 2: terms.push(name.slice(0, -2) + name.slice(-1)); break; // typo: one letter dropped
      case 3: terms.push(`Brand${(i * 13) % 400}`); break;
      case 4: terms.push(`ITM-${String(1 + ((i * 31) % ITEMS)).padStart(6, "0")}`.slice(0, 8)); break;
      case 5: terms.push(`89${String((i * 17) % ITEMS).padStart(11, "0")}`); break;
      case 6: terms.push(`${name} ${25 + ((i * 3) % 200) * 5}`); break;
      default: terms.push(""); break; // browse
    }
  }
  for (let i = 0; i < 20; i++) await get(`/api/items?q=${encodeURIComponent(terms[i])}`); // warm-up
  const times: number[] = [];
  let returned = 0;
  for (const q of terms) {
    const r = await get(`/api/items?q=${encodeURIComponent(q)}`);
    times.push(r.ms);
    returned += (r.body as unknown[]).length;
  }
  times.sort((a, b) => a - b);
  const search = { n: times.length, p50: quantile(times, 0.5), p95: quantile(times, 0.95), p99: quantile(times, 0.99), max: times[times.length - 1] };

  await get("/api/dashboard"); await get("/api/dashboard"); // warm-up
  const dash: number[] = [];
  for (let i = 0; i < 10; i++) dash.push((await get("/api/dashboard")).ms);
  dash.sort((a, b) => a - b);
  const dashboard = { n: dash.length, median: quantile(dash, 0.5), max: dash[dash.length - 1] };

  console.log("\nResults (through the HTTP API, signed in, row-level security on):");
  console.log(`  Item search, ${ITEMS.toLocaleString()} items, ${search.n} requests: p50 ${ms(search.p50)}, p95 ${ms(search.p95)}, p99 ${ms(search.p99)}, max ${ms(search.max)}  (gate: p95 < ${GATE_SEARCH_P95_MS} ms)`);
  console.log(`  Dashboard, ${LEDGER.toLocaleString()} ledger rows, ${dashboard.n} runs: median ${ms(dashboard.median)}, max ${ms(dashboard.max)}  (gate: < ${GATE_DASHBOARD_MS} ms)`);
  console.log(`  (search returned ${returned} rows in total, so it was not matching nothing)`);
  const searchOk = search.p95 < GATE_SEARCH_P95_MS;
  const dashOk = dashboard.max < GATE_DASHBOARD_MS;
  console.log(`\n${searchOk && dashOk ? "PASS" : "FAIL"}: search ${searchOk ? "ok" : "too slow"}, dashboard ${dashOk ? "ok" : "too slow"}`);
  failed = !(searchOk && dashOk);
} catch (e) {
  console.error("Performance run failed:", e);
} finally {
  await new Promise<void>(r => (server ? server.close(() => r()) : r()));
  await app.end();
  await admin.end();
  await db.stop();
}
process.exit(failed ? 1 : 0);
