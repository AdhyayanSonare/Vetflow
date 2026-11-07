# Progress

Only things that were run are listed as working. Last updated 2026-11-07, branch `integration`. Nothing has been pushed.

## Gates and measured numbers

| Gate | Result |
|---|---|
| `pnpm check` (types, lint, tests) | pass: 28 test files, 231 tests against a real PostgreSQL |
| Browser tests, phone 375 / tablet 768 / desktop 1280 | 92 pass on all three sizes. The newer workflow specs (dispense, receipt, voice switch) pass on desktop only |
| Fresh clone (clean `git clone`, install from lockfile, `pnpm check`, `pnpm demo`) | pass at a short path: install 5 s, check 114 s, demo healthy 21 s |
| Item search, 10,000 items | p50 114 ms, **p95 178 ms** (gate 300 ms), through the real API with row-level security |
| Dashboard, 500,000 ledger rows | median 1.14 s, max 1.17 s (gate 2 s). Margin is thin: it scans the ledger, so about 1M rows would breach |
| `pnpm audit` | 0 high or critical; 4 moderate (uuid via exceljs, not reachable; minimatch via eslint, dev only) |
| Licence allow list | 509 packages pass; one named build-only exception, lightningcss (MPL-2.0), never in the production tree |
| Secret scan | pass |
| Docker image build | builds, 563 MB. **Compose stack not run**, backup and restore drill not run |
| ASR accuracy | **not measured**: no real recordings. Harness built (`eval/asr`), scoring unit-tested |

## Security review (read-only subagent, from code only, nothing executed)

No cross-tenant read or write path and no SQL injection were found. Every route is gated; RLS, CSRF, sessions, uploads and exports were checked and found sound. Findings:

Fixed in this branch:
- HIGH: witness password could be guessed without limit. Now 5 misses per 15 minutes per user, then 429.
- MEDIUM: client Idempotency-Key shared a namespace with system keys (could cancel out a dispense or receipt). Client keys are now `client:<user>:<key>`, capped at 100 characters.
- HIGH (partly): controlled medicines could be issued with no second person. Plain issue is now refused for controlled items.

Open, in order of importance:
1. HIGH: the same witness rule is still missing on return, vial open/draw and transfers for controlled items.
2. MEDIUM: SECURITY DEFINER functions (`auth_lookup` returns password hashes) are executable by PUBLIC. Harmless on the Compose database, **exposed on Supabase if its Data API is on**. Needs a migration revoking PUBLIC; check with `has_function_privilege('anon','auth_lookup(text)','execute')`.
3. MEDIUM: config fails open: NODE_ENV defaults to development (no CSP, insecure cookies); COOKIE_SECURE=false accepted silently in production; `pnpm demo` binds all interfaces with a public password; `db:seed` would load the public-password admin on a fresh production database.
4. MEDIUM: lockout returns 423 vs 401 (account-existence oracle and lock-out DoS); no per-IP cap on sign-in; email not trimmed in limiter key.
5. MEDIUM: over-dispensing race (two parallel confirms) and uncapped lines with no quantity; a receipt can reprice an existing batch; the app role can insert ledger rows directly; anonymous large-body buffering; a crafted .xlsx can exhaust memory.
6. LOW: CI permissions and pinned images, backup passes the DB password on the command line and runs as root, no self-service password change, audit gaps on return, and others listed in the review.

Do not call the system production-hardened until items 1-3 are done.

## Built and verified

PostgreSQL schema with forced RLS and append-only ledger (11 migrations); accounts and roles; catalogue, purchasing, transfers, counts, vials, dispensing with doctor approval and controlled-item witness; nine reports with CSV/Excel; Excel import; voice transcription and drafting behind a provider interface; nightly worker; responsive React client; one-command demo; `tenant:create` and `user:set-password`; hooks, skills, runbooks, guides, ADRs, TEST-MAP.

## Bugs found by verifying (and fixed)

Production bundle landed in `dist/server/` so `pnpm start` and Docker could not start; pnpm 10 skipped the Postgres install step on fresh clones; password reset promised an email that could not be sent; a test that locked in a mangled message; three lint-level issues in new hooks; earlier: login type clash, PATCH resetting defaults, UTC/IST dates, consultation remount race, sign-in rate-limit stampede in e2e.

## Not done

Docker Compose run and restore drill; GitHub Actions run; browser flows for transfers, counts, orders, vials, import; phone/tablet runs of the new specs; offline queue; camera-scan fallback; legacy browser-data importer; return-to-store screen; email for password reset. Merge to `main` and push wait on the security items above and a final full check.

## Needs the user

Real recordings with transcripts (50+), the client's item list, a `GROQ_API_KEY`, approval before seeding the hosted Supabase project (public demo accounts), and the legal position on controlled-medicine registers.
