# Plan

Decisions taken on the user's behalf (all defaults accepted): PostgreSQL replaces MySQL; Manus OAuth and Groq are removed; Docker Compose with Caddy on one VM; valuation by actual batch cost; controlled medicines use an item flag with a reason and second-user confirmation; multi-dose vials are tracked, optional per item; seed data is synthetic.

Demo requirement: every screen works at 375, 768 and 1280 px, with touch targets of at least 44 px.

| Wave | Work | Owners |
|---|---|---|
| 0 | ADRs, OpenAPI contract, schema v1, CLAUDE.md, skills, hooks, split Home.tsx into routed modules | integrator |
| 1 | Postgres + RLS + tenancy; auth, roles, audit; UI shell and Astraon tokens; ASR spike; CI, Docker, test harness | schema, api, ui, voice, ops |
| 2 | Ledger service; catalogue and suppliers; purchasing and receipts; clinical modules on server; voice in consultation | ledger, api, ui, voice |
| 3 | Dispensing; transfers, counts, wastage, vials; alerts and nightly jobs; dashboard, reports, import | ledger, reports, api, ui |
| 4 | Barcode flag; subscription settings; security review; load test; backup/restore drill; docs; pilot seed | all |

Each wave ends with a merge to main and a `pnpm check` run. Fix loops stop at 8 tries, then write `docs/blockers/<n>.md`.
