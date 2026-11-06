# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Vetflow is clinical records, prescriptions and medicine inventory for veterinary hospital groups, by Astraon Labs. One Node app (Express API + React client) on PostgreSQL with row-level security. Money is integer paise; the database stores UTC and the UI shows India time (Asia/Kolkata).

## Commands (pnpm 10, Node >= 22.12)

- `pnpm demo` / `pnpm demo:reset`: embedded PostgreSQL + migrations + synthetic seed + built client at http://localhost:3000. No Docker or installed database needed. Demo sign-ins are public (`shared/demo.ts`).
- `pnpm check`: typecheck (server, client, e2e) + ESLint + all tests. Run before every commit.
- `pnpm test`: vitest. One file: `pnpm vitest run tests/api/auth.test.ts`; one test: add `-t "name"`. A real PostgreSQL starts once per run (`tests/globalSetup.ts`, port 54330); no mocks for the database.
- `pnpm e2e`: Playwright at phone 375, tablet 768, desktop 1280 (builds and serves its own demo on port 3100). `pnpm e2e:install` first.
- `pnpm build` then `pnpm start`: flat bundles `dist/index.js`, `worker.js`, `db-migrate.js`, `tenant-create.js`, `user-set-password.js` plus `dist/public`.
- `pnpm db:migrate | db:check | db:baseline | db:seed`, `pnpm tenant:create`, `pnpm user:set-password`, `pnpm worker`, `pnpm licences`, `pnpm secrets`.

## Layout

- `server/`: `app.ts` (createApp from a pool, no globals), `start.ts`, `config/env.ts` (the only reader of `process.env`), `http/` (route wrapper, errors, middleware), `db/` (pool/withTenant, migrate, seed, bootstrap, signature), `jobs/` (nightly + pg-boss worker), `modules/<domain>/` (auth, catalogue, purchasing, stock, clinical, dispensing, reports, importer, attachments, admin, voice).
- `client/src/`: `app/` (shell, router, nav), `api/client.ts` (the only `fetch`), `features/<area>/` (api hooks, pages, dialogs, pure logic), `components/{ui,common}`, `lib/`, `styles/` (Astraon tokens).
- `shared/`: permission map, demo constants, request/response types used by both sides.
- `db/migrations/`: SQL, checksummed, applied files are immutable (a hook blocks edits). Fix forward with a new numbered file.
- `asr/`: optional Python speech service. `deploy/`, `Dockerfile`, `docker-compose.yml`: production. `docs/`: architecture, runbooks, guides, ADRs, PROGRESS.

## Rules that must not break

1. **One stock writer.** Every quantity change goes through the SQL function `apply_stock_movement` (see `server/modules/stock/ledger.ts`). The ledger is append-only (the app role cannot UPDATE/DELETE it) and balances are only written by that function. Never write `stock_balances` or edit ledger rows. Use the `ledger-invariants` skill.
2. **Tenant safety.** Every table has `tenant_id` and FORCE RLS keyed on `app.tenant_id`, set per transaction by `withTenant`/`route()`. Foreign keys bypass RLS, so call `ensureOwned()` on every id from a request body. New table = tenant_id + policy + grants in a migration + an RLS test. Use the `tenant-safety` skill.
3. **Drafts, then a human.** Voice, extraction and imports only produce drafts. A vet approves a prescription (frozen by DB triggers afterwards). Only a confirmed dispense removes stock; a receipt adds stock only when confirmed. Never auto-fill clinical fields as final.
4. **Every high-impact action asks first** (`useConfirm()` on the client) **and is audited** (`auditTx` in the same transaction on the server).
5. **Manual entry is first-class.** Voice and barcode are per-tenant flags; the app is complete with both off.
6. **Permissions** live in `shared/permissions.ts` only. Check on the server with `route(pool, "<permission>", ...)`; the client only hides things.
7. **No fetching of user-supplied URLs** (SSRF); no secrets, API keys or personal data in code, logs, URLs or commits.

## Conventions

- New API endpoint: add to the module's `routes.ts` inside `route()`, validate with zod, throw `HttpError`/`notFound`, add a test in `tests/api/`. Errors reach the client as `{ error: { code, message } }` with plain sentences.
- New screen: `features/<area>/` with `api.ts` (TanStack Query hooks), a page, and logic in pure functions or a hook, not in the component. Add the route in `app/Router.tsx` and an entry to `e2e/smoke.spec.ts`. Use the `vetflow-ui` skill.
- Naming: files `PascalCase.tsx` for components, `camelCase.ts` for modules, SQL `snake_case`, API JSON `camelCase`.
- UI text: sentence case, plain words, no jargon, nothing under 12px, touch targets at least 44px, inputs 16px, no horizontal scroll at 375px.
- Config only through `server/config/env.ts` and `.env.example`; browsers get public settings only from `/api/features`.
- Lint is strict (`no-console` outside scripts/tests, no `any`). Keep functions small; comments explain why.

## Gotchas learned the hard way

- **Windows path length:** the bundled PostgreSQL fails if the project path is deeper than ~90 characters. `scripts/lib/embedded.ts` explains this; clone to a short path.
- **pnpm 10 skips dependency install scripts** unless listed in `pnpm-workspace.yaml` `onlyBuiltDependencies`. Add new native packages there or fresh clones break.
- **Build output must be flat** (`entryNames: [name]` in `scripts/build-server.ts`); `tests/unit/bundle.test.ts` guards the Docker layout.
- SQL parameters used as both uuid and text need explicit casts (`$1::uuid`, `$1::uuid::text`).
- Supabase's `postgres` role has BYPASSRLS but is not a superuser; PG17 and PG18 differ on NOT NULL constraints, so the schema signature ignores them. Auto-RLS there can skip policies: migration 0011 fixes forward.
- Dates: use `today_ist()` in SQL and the helpers in `client/src/lib/format.ts`; never `new Date().toISOString().slice(0,10)` for a business date.
- Backslashes in generated strings (Windows paths) get mangled by shell heredocs: write such files with the Edit/Write tools.
- Password reset by email is not wired (no mail server). By design the API says so and creates no token; admins set passwords.

## Definition of done

`pnpm check` green, new behaviour has a test, `pnpm e2e` green if UI changed, docs touched if behaviour changed, and nothing unverified is described as working in `docs/PROGRESS.md` (record numbers you measured, flag what you did not run).
