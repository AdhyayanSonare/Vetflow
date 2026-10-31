# VetFlow Frontend Audit

Branch: `frontend-edits` · Date: 31 Oct 2026 · Scope: `client/` (the whole UI lives in `client/src/pages/Home.tsx` + `client/src/index.css`)

Audited against: the source, a production build (`vite build`), and the live site (https://vetflow-ncwdvzha.manus.space) emulated at 375×812 (phone).

Primary user: a veterinarian, usually standing, often one-handed, between animals, on a phone. Every finding is ranked by how much it hurts *that* user.

Severity: **P0** breaks the core flow or is a real security risk · **P1** measurable slowdown or friction on mobile · **P2** polish / AI-slop cleanup.

---

## 1. Measured baseline

| Metric | Value | Comment |
|---|---|---|
| JS bundle (single chunk) | **530 KB min / 148 KB gzip** | Vite warns >500 KB. The app is a demo with zero server calls, yet ships tRPC, React Query, superjson, Radix, sonner. |
| CSS | **144 KB min / 25 KB gzip** | Tailwind + tw-animate + 53 shadcn components are pulled in, but the app uses ~0 Tailwind utilities. Hand-written CSS is ~600 lines. |
| Unused UI kit | 53 files in `components/ui/`, `ComponentShowcase.tsx` (1,437 lines), `AIChatBox`, `Map`, `ManusDialog`, `DashboardLayout` | Not imported by Home; most are tree-shaken from JS, but their deps sit in `package.json` and their CSS is still generated. |
| Third-party scripts on prod | `manus-analytics.com/script.js` + a Plausible-style tracker, firing 4 `event`/`send` requests on load | Analytics on a clinical app, loaded synchronously before first paint. |
| Rendered font sizes on dashboard | **43 text nodes at 9px**, 18 at 10px, 21 at 11px | Most of the UI is below a readable mobile minimum (≥13px body, ≥12px meta). |
| Input font size | **11px** | iOS Safari auto-zooms on focus for inputs <16px — every form field triggers a zoom jump. |
| Tap targets under 44×44 | **18 of 29** visible on the dashboard | Icon buttons are 32×32, text buttons ~16px tall. |
| Patients table on 375px | table 443px inside a 343px wrapper | Horizontal scroll inside a card. |
| First contentful paint (warm) | ~360 ms on desktop network | Fine on Wi-Fi; on 4G the 148 KB gzip JS parse is the bottleneck. |

---

## 2. P0 — Core flow and security

### 2.1 Consultation route is not a route
`startConsultation()` calls `setView("consultations")` but **never `setLocation`**. On a phone:
- the URL stays `/` → browser back button leaves the app mid-recording;
- a refresh (or iOS killing the tab in background — very common) drops the whole in-progress consultation: `activeConsultation`, `notesDraft`, `medicinesDraft`, `elapsed` are React state only, never persisted.
- Meanwhile navigating to `/consultations` directly shows the recorder for whatever patient is selected, with no active consultation.

**Fix:** `/consult/:patientId` route; persist the in-progress draft to storage on every change; resume on load.

### 2.2 Patient-specific URLs don't exist
Selected patient is in memory (`selectedPatientId` default `VET-2026-00124`). Opening `/patients` always shows Bruno. Can't share, bookmark, or go "back" to a patient.

**Fix:** `/patients/:id` with the list at `/patients`.

### 2.3 Clinical data in `localStorage`, unencrypted, forever
`vetflow-demo-state` stores patients, owner phone numbers, transcripts and prescriptions in plain text with no expiry. Fine for a demo — but the README/plan treat it as the persistence layer. On a shared clinic phone/tablet, anyone opening the browser sees everything.

**Fix (frontend scope):** keep it explicitly demo-only; namespace the key with a schema version; add "Clear demo data" in Settings; never put real data here. Real persistence must go to the backend (`drizzle/schema.ts` currently only has `users`).

### 2.4 Auth bearer token read from `sessionStorage`
`main.tsx` forwards `sessionStorage["manus-cookie"]` as `Authorization: Bearer`. Any XSS (or any third-party script — see 2.5) can read it. It's a platform fallback for iframe previews; it should not be active in production.

**Fix:** gate behind `import.meta.env.DEV` or a preview flag.

### 2.5 Third-party analytics on a medical app
Production loads two analytics scripts that record page views, outbound links and "tagged events". Patient names appear in the DOM and URL paths (once 2.2 is fixed, IDs will too). No consent, no CSP.

**Fix:** remove or self-host with a strict allowlist; add a `Content-Security-Policy` header in `server/_core/index.ts` (`script-src 'self'`).

### 2.6 `maximum-scale=1` in the viewport meta
Blocks pinch-zoom. Accessibility failure (WCAG 1.4.4) and actively harmful when text is 9px. It was probably added to hide the iOS input-zoom bug (see §1) — fix the cause (16px inputs) instead.

### 2.7 Debug collector script in `client/public/`
`client/public/__manus__/debug-collector.js` (899 lines) records console, network and *every UI interaction including typing*. It's only injected in dev, but the file is still copied into `dist/public/` and publicly fetchable.

**Fix:** move it out of `public/` or exclude it from the prod build.

---

## 3. P1 — Mobile performance and workflow friction

### 3.1 Bundle weight vs. what's used
- `@trpc/*`, `@tanstack/react-query`, `superjson`: wired up in `main.tsx`, used by **zero** components.
- `@radix-ui/react-tooltip` + `TooltipProvider`, `sonner` *and* a hand-rolled `.toast-feedback`: two toast systems fire for every action (`notify()` calls both).
- `framer-motion`, `recharts`, `streamdown`, `embla`, `cmdk`, `vaul`, `react-day-picker`, `axios`, `@aws-sdk/*`: in deps, unused by the UI.
- Single chunk: Inventory/Reports/Settings (rarely opened on mobile) load upfront.

**Target:** < 90 KB gzip initial JS. Remove dead providers, lazy-load secondary views with `React.lazy`, drop sonner or the custom toast (keep one).

### 3.2 CSS weight
`@import "tailwindcss"` + `tw-animate-css` generate ~120 KB for nothing (the app uses class names like `.card`, `.stat-card`, not utilities). Either commit to Tailwind or drop it; mixing both is the worst of both.

### 3.3 Mobile information order is wrong
- **Patients:** on phone the selected profile (Bruno) is forced on top (`order: -1`), the directory is pushed below a ~1,000px profile. A vet opening "Patients" wants the list/search first.
- **Dashboard:** above the fold on 375px = greeting + two buttons + a demo banner. Today's appointments (the thing a vet actually checks) start at ~y=740. Four vanity stat cards come first.
- **Consultation:** the record button is below the fold (patient card + 4-step stepper + header copy + waveform come first). The stepper overflows horizontally with a visible scrollbar.

### 3.4 No persistent mobile navigation
Navigation is a hamburger → slide-out drawer. Getting from Dashboard to Patients is 2 taps + a drawer animation. Phones want a bottom tab bar for the 4–5 primary destinations.

### 3.5 Global search hidden on phone
On ≤620px the search input is `display:none`; only the icon remains and **tapping it does nothing** (there's no handler — the icon sits inside a div). Search is the #1 way a vet finds a patient.

### 3.6 Timer and render cost during recording
`elapsed` lives in the root `Home` component → the **entire app re-renders once per second** while recording (header, sidebar, every view). Also 32 waveform bars animate via CSS `transform` (OK), plus a pulsing halo with `box-shadow` (paint-heavy).

**Fix:** move the timer into `RecordingPanel`; keep waveform to `transform`/`opacity` only.

### 3.7 `Home.tsx` is one 483-line file with 600+-character lines
Every state change re-renders every view's props. Components defined in the same file is fine, but all state (search inputs, filters, modals, recording) is hoisted to the root. Typing in the patient search re-renders the topbar, sidebar, etc.

**Fix:** split into `views/`, colocate state where it's used.

### 3.8 Forms aren't mobile forms
- Phone field: plain `<input>` → no `type="tel"` / `inputMode="tel"`, so iPhone shows the letter keyboard. Same for weight (`inputMode="decimal"`), email (`type="email"`).
- No `autoComplete` attributes.
- Required fields only marked with `*` in the label; phone is "required" by label but not by validation.
- Modals are bottom sheets on mobile (good) but have no drag handle and `93vh` max-height uses `vh` (jumps with the iOS URL bar — use `dvh`).

### 3.9 Hard-coded data that breaks as soon as anything changes
- Date is frozen: `new Date(2026, 9, 31)`, `"31 Oct 2026"` and `"Saturday, 31 October 2026"` are string literals in ~10 places.
- "Change patient" picker lists 5 hard-coded patients, ignoring newly registered ones.
- Appointments → patient lookup is a hard-coded `if pet === "Bruno"` chain.
- Stats (`1,248`, `18`, `7`, `14`) are literals, unrelated to data.
- Patient ID = `124 + patients.length` → collides after any deletion; consultation ID likewise.
- New appointments save `owner: "Auto-filled owner"`.
- "Total consultations" = `consultations.length + 2`.

These aren't just demo shortcuts — they make the UI lie as soon as a vet uses it.

### 3.10 Dead controls (look tappable, do nothing)
`⌘K` hint (meaningless on phone), stat card `…` menus, "More filters", "More actions", clinic switcher chevron, doctor menu chevron, "Play recording", "Filter schedule", Day/Week/Month (changes a label only), Prev/Next day, prescription search input, all Settings fields and toggles, Settings tabs, "Download PDF" (toast only). On a phone every dead tap costs trust.

### 3.11 Accessibility
- No `:focus-visible` styles for buttons/nav (only form fields have a focus ring).
- No `prefers-reduced-motion` handling despite the plan requiring it.
- Table rows are clickable `<tr onClick>` — not keyboard reachable.
- Modals: no focus trap, no `Escape` to close, no `role="dialog"`/`aria-modal`.
- Colour contrast: `--muted #849690` on white ≈ 3.2:1 at 9px — fails AA.

---

## 4. P2 — AI slop inventory

What makes it read as generated rather than designed:

| Pattern | Where | Replace with |
|---|---|---|
| Eyebrow label above *every* heading (`PATIENT MANAGEMENT`, `SHORTCUTS`, `CARE ACTIVITY`, `PRACTICE INTELLIGENCE`…) in 9px tracked caps | every card/page | Drop. A heading is enough. |
| Marketing subtitles under every page title ("One clear record for every animal in your care.", "Keep the day moving without losing the care context.") | every page | Drop. Doctors know what the Patients page is. |
| Sparkles icon for "AI" | demo banner, guardrails card, notes badge | Plain text label "Transcribed" / "Draft". |
| Four KPI stat cards with fake `↑12%` deltas and `…` menus | dashboard | One line: "4 of 18 seen · 7 follow-ups due". |
| Decorative "Demo workspace" card repeated 3× (sidebar, dashboard banner, badge on consultation) | everywhere | One small persistent "Demo" pill in the header. |
| Reassurance copy blocks ("VetFlow never invents clinical findings", "Previous records stay separate. Nothing is overwritten.", "Doctor approval is the final gate") | consultation, prescriptions | One line of helper text at the point of approval. |
| Avatar = initial + tiny paw icon in pastel tones | patients | Species icon or initial; no double-glyph. |
| Leaf + paw logo mark with drop shadow and asymmetric radius | brand | Simpler mark; no shadow. |
| `translateY(-1px)` hover lift on all buttons + coloured shadows | `.button` | Flat buttons, colour change on press. Hover is irrelevant on touch. |
| Mic "orb" with halo + 32-bar fake waveform (bars are static heights, not audio) | recorder | One large record button; a slim live level line only while recording. |
| "Inventory" and "Reports" full pages of placeholder content | nav | Hide Inventory (coming soon) from mobile nav; Reports shows real counts or nothing. |
| Two toasts per action + toast for trivial actions ("Recording paused") | everywhere | One toast only for saves/approvals. State changes are visible in the UI already. |
| Copy like "Turn today's conversations into better records" | headers | Neutral, functional labels. |

---

## 5. Current workflow (as built)

```
Dashboard ──► New consultation (always Bruno / last selected)
   │            │
   │            ├─ Ready → Recording ⇄ Paused → Stop → Processing (1.8s fake)
   │            ├─ Transcript shown → "Review clinical notes" (scrolls page)
   │            ├─ Notes (7 textareas) → Save / Continue
   │            └─ Prescription (7 fields × N medicines) → Draft / Approve
   │                   └─ phase stays "prescription" after approve; no "done" screen
   ├─ Register patient (modal, 14 fields) → profile
   ├─ Patients: list + profile side by side; 6 tabs (2 are empty placeholders)
   ├─ Prescriptions: table + preview of the first one
   ├─ Appointments: list; "day/week/month" non-functional
   └─ Inventory / Reports / Settings: static
```

**Gaps in the flow itself:**
1. Starting a consultation doesn't ask *which* patient — it silently uses whichever was last selected.
2. No way to start a consultation from an appointment (the most natural entry: "Max, 10:00, In Progress → Start").
3. After approval, there's no completion state, no "Print / Share with owner / Next patient" step. The doctor is left on an edit form.
4. Transcript → notes requires a tap on "Review clinical notes" which just scrolls; the phase is already `notes`, so the transcript disappears.
5. Prescription editor shows 7 inputs per medicine, all equal weight. On a phone that's ~14 fields to scroll for 2 medicines.
6. No search on Prescriptions/Consultations lists (input is decorative).
7. Appointment status never changes (can't mark Arrived / Done).
8. No owner-level view (multiple pets per owner is in the brief but not navigable).

---

## 6. Priority fix list

| # | Fix | Severity | Effort |
|---|---|---|---|
| 1 | Real routes (`/patients/:id`, `/consult/:id`), persist in-progress consultation | P0 | M |
| 2 | Remove `maximum-scale=1`; inputs 16px; base type scale ≥13px | P0 | S |
| 3 | Gate sessionStorage bearer + debug collector to dev; drop analytics / add CSP | P0 | S |
| 4 | Bottom tab bar on mobile; working search on mobile | P1 | M |
| 5 | Patients: list-first on mobile, profile as its own screen | P1 | M |
| 6 | Strip unused deps/providers, one toast system, lazy secondary views | P1 | M |
| 7 | Consultation: patient picker first, record button above the fold, completion screen | P1 | M |
| 8 | Start consult from appointment; appointment status changes | P1 | S |
| 9 | Replace hard-coded dates/IDs/stats/patient lists with derived data | P1 | S |
| 10 | Remove or wire every dead control | P1 | S |
| 11 | Focus states, reduced motion, dialog semantics, contrast | P1 | S |
| 12 | AI-slop cleanup per §4 + new visual system per DESIGN.md | P2 | M |
| 13 | Decide Tailwind vs. plain CSS; delete unused `components/ui`, showcase | P2 | S |
