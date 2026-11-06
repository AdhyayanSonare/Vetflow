# Progress

## Wave 0 (in progress)
- [x] Recon, docs/ARCHITECTURE.md
- [x] docs/PLAN.md
- [x] Project subagents in .claude/agents/
- [ ] ADRs (database, auth, asr)
- [ ] OpenAPI contract
- [ ] Schema v1 (Postgres)
- [ ] CLAUDE.md rewrite (150 lines or fewer), skills, hooks
- [ ] Split Home.tsx into routed modules

## Wave 1/2 work done so far
- [x] Postgres schema v1 (db/migrations 0001-0004), forced RLS, app role, append-only ledger and audit log
- [x] Checksummed migration runner (applied migrations are immutable)
- [x] Ledger: one SQL function writes ledger row and balance together; FEFO, receipts, transfers, reconcile
- [x] Tests on a real PostgreSQL 18: 27 DB tests (RLS as app role, ledger properties, race on last unit, idempotency, overrides)
- [x] Auth: Argon2id, 12-hour sessions with hashed tokens, CSRF header check, lockout after 5 failures, per-address rate limit, password reset (token delivery is logged in dev; no mail server yet), role permission map, security headers. 12 tests.
- [ ] Supabase demo database: project found (Tokyo, empty); needs the database password in .env (not yet supplied)

## Gate results
`pnpm vitest run tests/db`: 39 of 39 pass (DB, ledger, auth) (2026-11-07). Full `pnpm check` and e2e not yet in place.

## Measured numbers
None yet. ASR figures stay empty until real recordings exist.

## Decisions made on the user's behalf
See docs/PLAN.md.
