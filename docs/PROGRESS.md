# Progress

Only things that were run are listed as working. Last updated 2026-11-07, branch `integration`. Nothing has been pushed.

## Gates and measured numbers

| Gate | Result |
|---|---|
| `pnpm check` (types, lint, tests) | pass: 28 test files, 231 tests against a real PostgreSQL |
| Browser tests, phone 375 / tablet 768 / desktop 1280 | 101 of 101 pass (full run: 100 passed, then the one phone failure was a test selector bug picking a hidden duplicate; fixed and the workflow specs re-run green at all three sizes). Not covered in a browser: transfers, counts, orders, vials, import |
| Fresh clone (clean `git clone`, install from lockfile, `pnpm check`, `pnpm demo`) | pass at a short path: install 5 s, check 114 s, demo healthy 21 s |
| Item search, 10,000 items | p50 114 ms, **p95 178 ms** (gate 300 ms), through the real API with row-level security |
| Dashboard, 500,000 ledger rows | median 1.14 s, max 1.17 s (gate 2 s). Margin is thin: it scans the ledger, so about 1M rows would breach |
| `pnpm audit` | 0 high or critical; 4 moderate (uuid via exceljs, not reachable; minimatch via eslint, dev only) |
| Licence allow list | 509 packages pass; one named build-only exception, lightningcss (MPL-2.0), never in the production tree |
| Secret scan | pass |
| Docker Compose stack (throwaway config, local Docker Desktop) | pass: postgres, migrate, api, worker, proxy, backup all up; health, app and CSP headers through the proxy; `tenant-create` in the container; sign-in and API call. Found and fixed: the backup image used Alpine 3.20 which has no Postgres 17 client. Not tested: TLS/domain, the `asr` and `uptime` profiles, a real off-site restic target |
| Backup and restore drill | pass on a near-empty database: backup 5 s, restore into a fresh database 2 s, 54 of 54 checksums match. **Timing for a real clinic-sized database is unmeasured** |
| ASR accuracy | **not measured**: no real recordings. Harness built (`eval/asr`), scoring unit-tested |

## Security review (read-only subagent, from code only, nothing executed)

No cross-tenant read or write path and no SQL injection were found. Every route is gated; RLS, CSRF, sessions, uploads and exports were checked and found sound. Findings:

Fixed in this branch:
- HIGH: witness password could be guessed without limit. Now 5 misses per 15 minutes per user, then 429.
- MEDIUM: client Idempotency-Key shared a namespace with system keys (could cancel out a dispense or receipt). Client keys are now `client:<user>:<key>`, capped at 100 characters.
- HIGH (partly): controlled medicines could be issued with no second person. Plain issue is now refused for controlled items.

Also fixed (migration 0012, `db:seed`, start-up warnings):
- PUBLIC can no longer execute the lookup and stock functions; only `vetflow_app` can. The app role can no longer insert ledger rows or touch `schema_migrations`. **Still check on Supabase** with `has_function_privilege('anon','auth_lookup(text)','execute')` after running `pnpm db:migrate`.
- `pnpm db:seed` refuses a non-local database without `--allow-remote`. Starting in production with insecure cookies, or without NODE_ENV, logs a warning. (Not fixed: `pnpm demo` still listens on all interfaces on purpose, so phones on the same Wi-Fi can reach it; it uses a public password, so never run it on an untrusted network.)

Open, in order of importance:
1. HIGH (narrowed): plain issue and return now refuse controlled items. Still missing a second-person step: opening a controlled multi-dose vial (kept allowed because the demo and real practice use ketamine vials, so it needs a witness field, not a block) and transfers of controlled stock.
2. MEDIUM: lockout returns 423 vs 401 (account-existence oracle and lock-out DoS); no per-IP cap on sign-in; email not trimmed in limiter key.
3. MEDIUM: over-dispensing race (two parallel confirms) and uncapped lines with no quantity; a receipt can reprice an existing batch; anonymous large-body buffering; a crafted .xlsx can exhaust memory.
4. LOW: CI permissions and pinned images, backup passes the DB password on the command line and runs as root, no self-service password change, audit gaps on return, and others in the review.

Do not call the system production-hardened until item 1 is done.

## Built and verified

PostgreSQL schema with forced RLS and append-only ledger (11 migrations); accounts and roles; catalogue, purchasing, transfers, counts, vials, dispensing with doctor approval and controlled-item witness; nine reports with CSV/Excel; Excel import; voice transcription and drafting behind a provider interface; nightly worker; responsive React client; one-command demo; `tenant:create` and `user:set-password`; hooks, skills, runbooks, guides, ADRs, TEST-MAP.

## Bugs found by verifying (and fixed)

Production bundle landed in `dist/server/` so `pnpm start` and Docker could not start; pnpm 10 skipped the Postgres install step on fresh clones; password reset promised an email that could not be sent; a test that locked in a mangled message; three lint-level issues in new hooks; earlier: login type clash, PATCH resetting defaults, UTC/IST dates, consultation remount race, sign-in rate-limit stampede in e2e.

## Not done

GitHub Actions run; TLS with a real domain; off-site backup target; browser flows for transfers, counts, orders, vials, import; phone/tablet runs of the new specs; offline queue; camera-scan fallback; legacy browser-data importer; return-to-store screen; email for password reset. Merge to `main` and push wait on the security items above and a final full check.

## Needs the user

Real recordings with transcripts (50+), the client's item list, a `GROQ_API_KEY`, approval before seeding the hosted Supabase project (public demo accounts), and the legal position on controlled-medicine registers.
