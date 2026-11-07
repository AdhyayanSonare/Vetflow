# ADR 0003: Client structure and state

Status: accepted.

The demo client was one 538-line file with data in `localStorage`. It is replaced by a routed client on the same toolchain (React 19, Vite, Tailwind 4).

- **Router:** wouter, with a table of pages (`app/Router.tsx`), each lazy-loaded and optionally guarded by a permission.
- **Server state:** TanStack Query. One place (`api/client.ts`) calls `fetch`, adds the CSRF header, turns failures into typed errors, and signs the user out on a 401. Nothing clinical is kept in the browser.
- **Local state:** React state and hooks near where they are used. The only context is the signed-in user. The consultation is a small state machine in a hook (`useConsultationFlow`) with pure helpers in `logic.ts`, so the rules are unit-tested without rendering.
- **Forms:** react-hook-form with zod for forms of more than two fields; plain state for one-field dialogs.
- **Components:** a small shadcn/Radix subset in `components/ui`, and Vetflow-specific building blocks in `components/common` (page, table-that-becomes-cards, responsive dialog, confirm, fields, states). Features compose these and never re-style them.
- **Brand:** Astraon tokens as CSS variables mapped into Tailwind; Source Serif 4, IBM Plex Sans and IBM Plex Mono self-hosted; sentence case; wordmark only.
- **Responsive by test, not by hope:** every page is loaded at 375, 768 and 1280 px in Playwright, and checked for horizontal scroll, 44 px touch targets and the right navigation for the width.
- **Offline:** not built. A service worker with a queued-writes outbox was in the brief; it is deliberately left out of the demo because stock writes must not be replayed blindly. When added, queued actions must carry idempotency keys (the server already honours them).
- **Not used:** Redux or other global stores (server state is the bulk of the state), CSS-in-JS, a component library with its own theme.
