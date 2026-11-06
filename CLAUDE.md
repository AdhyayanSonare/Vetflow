# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is pnpm (10.18.0).

- `pnpm dev` — Express + Vite dev server via `tsx watch server/_core/index.ts` (honors `PORT`, default 3000). `pnpm dev:static` runs Vite alone (no backend).
- `pnpm build` / `pnpm start` — Vite builds the client to `dist/public/`; esbuild bundles the server to `dist/index.js`.
- `pnpm check` — `tsc --noEmit` (type check; there is no linter).
- `pnpm test` — `vitest run`. Single file: `pnpm vitest run server/voiceUpload.test.ts`; single test: add `-t "name"`.
- `pnpm db:push` (generate + migrate) / `pnpm db:migrate` — Drizzle Kit against MySQL.
- `pnpm format` — Prettier.

Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`.

## Architecture

React 19 / Express / tRPC 11 / Drizzle (MySQL) app, adapted from a Manus "web-db-user" template. `server/_core/` and `client/src/_core/` are platform scaffolding (OAuth, LLM, storage proxy, maps, notifications, Vite middleware); avoid modifying them unless necessary.

**The app is currently frontend-first demo.** `client/src/pages/Home.tsx` is a single large file holding the whole dashboard (Dashboard, Patients, Consultations, Prescriptions, Appointments, Reports, Settings) as one responsive workspace; view is state-driven from the URL path (`viewFromPath`), and `App.tsx` routes everything to `Home`. All clinical data is seeded demo data persisted in `localStorage` (`vetflow-demo-state`), not the database. The DB schema (`drizzle/schema.ts`) only has the `users` table, and `server/routers.ts` only exposes `system` and `auth` — feature routers are not yet added. `plan.md` and `TODO.md` hold the design decisions and acceptance checklist.

**Voice transcription is the one real backend feature** and does not go through tRPC:
- Client: `client/src/hooks/useAudioRecorder.ts` (MediaRecorder) and `client/src/lib/voice.ts` (validation/upload) post raw audio bytes to `POST /api/voice/transcribe`.
- Server: `server/voiceUpload.ts` validates content type, magic bytes and the 25 MB limit, rate-limits per client (12/min), and calls Groq Whisper through `server/_core/voiceTranscription.ts`. Shared types/constants are in `shared/voice.ts`.
- Needs `GROQ_API_KEY` in `.env` (optional `GROQ_API_URL`). The key stays server-side. The old URL-based tRPC mutation was deliberately removed (SSRF risk) — do not reintroduce fetching user-supplied URLs.
- The endpoint has no auth check (the UI has no login flow); add auth before public exposure.
- Transcripts are shown verbatim; clinical note fields are never auto-filled by AI — the veterinarian completes them.

Backend routes must be under `/api/` (gateway routing). Public runtime config exposed to the browser goes only through `server/_core/publicConfig.ts`.

Tests live next to code (`server/*.test.ts`, `client/src/lib/voice.test.ts`); Groq is mocked in voice tests.
