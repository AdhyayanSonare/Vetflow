# Plan and checklist

The single source of truth for what is done and what is left. Updated at every step. Status: `[x]` done and tested, `[~]` partly done, `[ ]` not started.

## Decisions taken on the user's behalf
- PostgreSQL replaces MySQL. Manus OAuth and the unauthenticated Groq route are removed.
- Hosted APIs are allowed for now: Groq Whisper for transcription and Groq chat for note extraction (from the collaborator's branches). The local `asr` service (Canary, faster-whisper) is built and selectable, but its accuracy on real clinic audio is unmeasured.
- The deployed demo database is the Supabase project in `.env` (Sydney, ref `oxeuunpcdtstanrxniwa`). The project in the first dashboard link (Tokyo) is not used.
- Brand: Astraon tokens from the brief, applied to the collaborator's mobile-first UX (bottom tab bar, centre Record button, 44 px targets, 16 px inputs).
- Controlled medicines: item flag, reason and second-user password confirmation. No legal claims in the UI.
- Valuation: actual cost per batch. Multi-dose vials: tracked, optional per item.

## Backend
- [x] PostgreSQL schema, forced RLS, append-only ledger and audit log (migrations 0001-0011)
- [x] Stock ledger: one SQL function, FEFO, idempotency, negative-stock override with audit, reconciliation
- [x] Accounts: Argon2id, sessions, CSRF, lockout, rate limit, password reset, five roles, branch scoping
- [x] Catalogue with pg_trgm similar-name warnings, suppliers, categories
- [x] Purchasing: draft and confirmed receipts, purchase orders with partial receipts, low-stock orders, invoice attachments
- [x] Stock operations: adjustments, issue to department, return, transfers via in-transit store, counts, multi-dose vials
- [x] Clinical: animals, consultations, transcripts, prescriptions with hard doctor approval, dispensing linked to prescriptions, controlled-item witness
- [x] Dashboard, nine reports, CSV and Excel export, alerts, nightly checks, transcript retention, pg-boss worker
- [x] Excel import with validation preview (opening stock as a draft receipt)
- [x] Voice: transcription route (Groq or local), LLM extraction with grounding, catalogue matching, split-word matching
- [x] Config module, strict TLS, pino logging, domain-module structure
- [x] Seed (synthetic, labelled), `pnpm demo` launcher, schema signature and baseline tools
- [x] Supabase database verified: 11 migrations recorded, 0 schema mismatches, app-role security checks pass
- [x] Server recovery commands: `pnpm tenant:create` (first clinic and admin) and `pnpm user:set-password` (locked-out admin), tested
- [x] Production bundle layout (flat `dist/*.js`) guarded by `tests/unit/bundle.test.ts`
- [ ] Legacy importer for the browser demo data (localStorage). Not started; the demo data is synthetic, so it only matters if the client used the old browser demo for real records.
- [x] Tests: see docs/TEST-MAP.md

## Frontend (rebuild, API-backed)
- [x] Structure: `client/src/{app,api,features,components,hooks,lib,styles}`, TanStack Query, business logic in hooks and pure modules
- [x] Astraon tokens (CSS variables + Tailwind theme), self-hosted Source Serif 4, IBM Plex Sans and Mono, dark theme
- [x] Shell: sidebar (desktop), icon rail (tablet), bottom tab bar with Record (phone)
- [x] Sign-in, password reset
- [x] Today (dashboard); alerts page with inventory
- [x] Patients: list, register, profile
- [x] Consultation flow: record or upload or type, transcribe, extract, review notes, prescription, approve, done (e2e at 3 sizes)
- [x] Prescriptions list, detail and print view (print layout checked at 3 sizes)
- [x] Dispensing queue, counter sale, controlled-item witness (dispense flow driven end to end in `e2e/workflows.spec.ts`)
- [~] Inventory: all screens built and loaded at 3 sizes; receipt entry and confirmation driven end to end. Orders, transfers, counts, vials and import are covered by API tests but not by browser flows.
- [~] Reports: nine reports, filters, CSV and Excel download, print. Pages load at 3 sizes; downloads are covered by API tests, not clicked in a browser test.
- [x] Settings: users, branches, feature flags (voice switch driven end to end), subscription, licences, audit
- [~] Barcode input: keyboard scanners work as typing; camera scan button behind the flag uses the browser's native BarcodeDetector only (no fallback library, so unsupported browsers show typing only)
- [x] Responsive at 375, 768 and 1280 px, 44 px targets, no horizontal scroll (checked on every page by Playwright)
- [~] Playwright tests at three sizes, screenshots in `docs/qa/`: smoke (every page), consultation, dispensing, receipt, voice switch. Not covered: transfers, counts, orders, vials, import in the browser.

## Operations and quality
- [x] ESLint in `pnpm check`; licence allow list (`pnpm licences`), secret scan (`pnpm secrets`) and `pnpm audit` in CI. Audit: 0 high or critical findings, 4 moderate (dev tooling and one unreachable exceljs path). One named build-only licence exception: lightningcss (MPL-2.0).
- [~] Docker Compose (proxy, api, worker, asr, postgres, backup), Caddy TLS, health checks: written; see PROGRESS for what was actually run
- [~] Encrypted backup and restore scripts written (restic); a timed restore drill has not been run
- [~] GitHub Actions workflow written for Linux, macOS and Windows; it has not run (nothing pushed yet)
- [x] Performance gates (`pnpm perf`): item search p95 178 ms at 10,000 items; dashboard 1.14 s at 500,000 ledger rows
- [~] ASR eval harness built and unit-tested (`eval/asr`); ADR written (`docs/adr/asr.md`). No accuracy numbers: no real recordings exist.
- [x] CLAUDE.md (56 lines), skills (ledger-invariants, tenant-safety, vetflow-ui), hooks (block applied-migration edits, lint after edits, typecheck + fast tests on stop)
- [x] Docs: ARCHITECTURE, runbooks (deploy, backup, restore, incident), admin and user guides, demo guide, TEST-MAP, ADRs
- [~] Fresh-clone verification done (install, check, demo from a clean clone); security review by a read-only subagent: see PROGRESS
- [ ] Merge into `main`; push only after everything above passes

## Needs the user
- Real consultation recordings with reference text (50 or more) to measure ASR accuracy.
- Client item list and opening stock.
- A `GROQ_API_KEY` in `.env` to enable hosted transcription and extraction in the demo.
- Whether controlled medicines carry any legal register requirement in the client's jurisdiction.
