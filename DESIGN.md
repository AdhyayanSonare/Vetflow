# VetFlow Design Spec

Companion to `AUDIT.md`. This is the target for the `frontend-edits` branch: **refine, don't revamp**. The brand colour, module list, data model and the core flow (patient → record → notes → prescription → approve) stay. What changes is information order, density, mobile ergonomics, and the removal of decoration.

---

## 1. Principles

1. **One hand, one thumb.** Designed at 375px first. Primary actions live in the bottom third of the screen. Tap targets ≥ 44px.
2. **The record is the interface.** Show clinical data, not descriptions of it. No eyebrows, no taglines, no reassurance paragraphs.
3. **Fast over pretty, then pretty.** Initial JS < 90 KB gzip; no layout shift; no animation on static screens.
4. **Every tap does something.** No control renders unless it works. Unbuilt features are hidden, not teased.
5. **The doctor approves; the UI never pretends.** AI output is visibly a draft until approved. Stats, dates and IDs are derived from data, never literals.

---

## 2. Visual system

### 2.1 Colour (keep the brand, cut the palette)

| Token | Value | Use |
|---|---|---|
| `--brand` | `#145c4a` | Primary buttons, active nav, links |
| `--brand-press` | `#0d4739` | Pressed state |
| `--brand-tint` | `#e9f3ee` | Selected rows, active tab bg |
| `--ink` | `#14231e` | Primary text (≥ 12:1 on white) |
| `--ink-2` | `#4a5d56` | Secondary text (≥ 6:1) |
| `--ink-3` | `#6b7c76` | Meta text, min 12px (≥ 4.5:1) |
| `--line` | `#e3e9e6` | Dividers, borders |
| `--surface` | `#ffffff` | Cards, sheets |
| `--canvas` | `#f6f8f7` | Page background |
| `--rec` | `#c2410c` | Recording state only |
| `--warn` | `#a16207` | Draft / needs approval / due |
| `--ok` | `#15803d` | Approved / completed |

Removed: purple, blue, mint-strong, amber-soft, pastel avatar tones, coloured shadows. Status colour appears as **text + small dot**, not filled pills in five colours.

Dark mode: not in this pass (clinic lighting is bright; revisit later). Tokens are structured so it can be added.

### 2.2 Type

System font stack (`-apple-system, "SF Pro Text", Roboto, "Segoe UI", sans-serif`) — zero font download, native feel. Drop the Inter reference (it isn't loaded anyway; it falls back to system).

| Role | Size / line / weight |
|---|---|
| Page title | 22 / 28 / 650 |
| Section title | 16 / 22 / 600 |
| Body / list primary | 15 / 22 / 500 |
| Secondary | 13 / 18 / 400 |
| Meta (min) | 12 / 16 / 500 |
| Inputs | **16** / 22 / 400 (prevents iOS zoom) |
| Numbers | `font-variant-numeric: tabular-nums` |

No uppercase-tracked eyebrows. Desktop (≥ 1024px) may scale body to 14px for density.

### 2.3 Space, shape, depth

- 4px base grid. Page gutter 16px mobile / 32px desktop.
- Radius: 10px cards/sheets, 8px inputs/buttons, full for the record button.
- **No shadows** on cards; separate with `--line` borders or background contrast. One shadow allowed: bottom sheets and popovers (`0 8px 24px rgb(0 0 0 / .08)`).
- Lists over cards: on mobile, sections are full-bleed lists with dividers, not floating cards with margins.

### 2.4 Motion — "minimal wave"

The only signature animation is a **single soft wave line** in the recorder. Everything else is functional.

| What | How | Duration |
|---|---|---|
| Recorder wave | One SVG path, amplitude driven by mic level (`AnalyserNode`), `transform`-only; flat line when paused; hidden when idle | live |
| Screen push (list → detail) | 12px slide + fade | 180ms ease-out |
| Bottom sheet | slide up | 220ms `cubic-bezier(.2,.8,.2,1)` |
| Button press | background colour change, `scale(.98)` | 80ms |
| Processing | thin indeterminate bar at top of the recorder card | loop |

Removed: hover lifts, mic halo pulse, 32-bar waveform, pulsing live dots, spinners inside buttons where a bar suffices.
`@media (prefers-reduced-motion: reduce)` → wave becomes a static level meter, transitions become instant.

---

## 3. Layout & navigation

### Mobile (< 768px)

```
┌──────────────────────────────┐
│ Title              [🔍] [DS] │  56px top bar, sticky, solid bg (no blur)
├──────────────────────────────┤
│                              │
│         content              │
│                              │
├──────────────────────────────┤
│  Today  Patients  (●)  Rx  ⋯ │  64px bottom tab bar + safe-area inset
└──────────────────────────────┘
```

- **Bottom tabs:** Today · Patients · **Record** (centre, brand-filled, 56px) · Prescriptions · More.
- **More** sheet: Appointments (full calendar), Reports, Settings, Clear demo data. Inventory hidden until built.
- Search icon opens a full-screen search overlay (patients, owners, phone, ID) with keyboard up.
- No hamburger, no sidebar, no breadcrumb on mobile.

### Tablet / desktop (≥ 1024px)

- Keep the left sidebar (collapsible), remove clinic switcher card and demo card from it.
- Patients becomes list + detail split view (current behaviour, kept).
- Top bar: search field (real input), date, profile.

### Routes

| Path | Screen |
|---|---|
| `/` | Today |
| `/patients` | Patient list |
| `/patients/:id` | Patient record (tab via `?tab=history`) |
| `/patients/new` | Register (sheet on mobile, modal on desktop) |
| `/consult/:consultId` | Consultation in progress (resumable) |
| `/consult/:consultId/done` | Completion |
| `/prescriptions` · `/prescriptions/:id` | List · document |
| `/appointments` | Schedule |
| `/reports`, `/settings` | Secondary |

All in-progress consultation state is persisted per `consultId`; reload or OS tab-kill resumes exactly where the vet was.

---

## 4. Screens & workflow

### 4.1 Today (replaces Dashboard)

Order is by "what do I do next":

1. **Next up** — the next Upcoming/In-progress appointment as one large row: time, pet, owner, reason, `[Start consult]`.
2. **Schedule** — rest of today's appointments as a list. Each row: time · pet (species icon) · reason · status text. Swipe or tap → actions: Start consult, Mark arrived, Call owner (`tel:`), Open record.
3. **Needs attention** — draft prescriptions awaiting approval, follow-ups due today. Each row taps straight into the item.
4. One summary line: `5 of 18 seen · 2 drafts · 7 follow-ups due`.

Removed: greeting hero, 4 stat cards, demo banner, quick-actions card (Record is in the tab bar; Register lives on Patients).

### 4.2 Patients

- **List first.** Sticky search (16px input, `inputMode="search"`), species filter as horizontal chips.
- Row: species icon · **Name** · breed/age · owner · last visit (right-aligned). 64px rows.
- `[+]` in top bar → Register.
- Tap row → **Patient record** screen:
  - Header: name, species · breed · age · weight, ID; **allergy chip in `--warn` if any** (clinically the most important fact — currently buried in a tab).
  - Owner row: name + `[Call]` + `[WhatsApp]` icon buttons (44px).
  - Sticky bottom button: `[● Start consultation]`.
  - Tabs reduced to **Summary · History · Prescriptions**. Vaccinations and Documents hidden until built.
  - History = one chronological list (merge "Medical History" and "Consultations", they show the same data).

### 4.3 Register patient

- Mobile: full-height sheet with a drag handle; desktop: modal.
- Step 1 (required, one screen): Pet name, species (chips), sex (segmented), age/DOB, owner name, owner phone (`type="tel"`). Save is enabled after these.
- "Add more details" expands: breed, weight (`inputMode="decimal"`), colour, microchip, allergies, conditions, email, address, photo.
- Owner phone match → offer "Add to existing owner (Rahul Sharma, 2 pets)" — covers the multi-pet requirement.

### 4.4 Consultation (the core flow, kept as 4 steps)

Entry points: tab bar **Record**, patient record button, appointment row. If no patient context → patient picker sheet first (search + recent + today's appointments). Never silently default to a patient.

**Step 1 — Record**
```
┌──────────────────────────────┐
│ ← Bruno · Labrador · 24 kg   │  compact patient strip; ⚠ allergies shown here
├──────────────────────────────┤
│                              │
│        00:42                 │  large tabular timer
│   ～～～～～～～～～～～～      │  single live wave line
│                              │
│  [Upload audio]   [Pause]    │
│          ( ■ )               │  72px stop button, thumb zone
└──────────────────────────────┘
```
- Idle state: one big `( ● Record )` button in the thumb zone; "Upload audio" as a secondary text button.
- No stepper bar on mobile — a small "1/3" in the header is enough. Desktop keeps a compact horizontal stepper.
- Timer state is local to the recorder component (no root re-render).

**Step 2 — Review notes**
- Transcript collapsed at top ("Transcript · 42s ▾") — tap to expand; it never disappears.
- Fields: Complaint, Duration, Examination, Diagnosis, Treatment, Follow-up. Each auto-grows.
- Fields extracted from speech show a subtle `from transcript` meta label; empty fields show a placeholder ("Not mentioned") rather than invented text.
- Diagnosis field carries `--warn` left border until edited by the doctor.
- Sticky bottom: `[Next: Prescription →]` (auto-saves; no separate Save button).

**Step 3 — Prescription**
- Each medicine is a **compact row**: `Name strength — dose · freq · duration`. Tap to edit in a sheet.
- Edit sheet: Name + strength on top; dose / route / frequency / duration as **chips with common values** (Oral / SC / IM; SID / BID / TID; 3 / 5 / 7 / 10 days) plus custom; instructions last.
- `[+ Add medicine]` row at the end; swipe-left to remove.
- "No medicines" is a valid outcome (vaccination visits).
- Sticky bottom: `[Save draft]` secondary + `[Approve]` primary. Approve asks for one confirmation sheet listing the medicines.

**Step 4 — Done** (new)
- ✓ Approved · Bruno · 31 Oct, 10:42
- Actions: `[Print]` `[Share PDF with owner]` `[Book follow-up in 5 days]` (pre-filled from notes)
- `[Next patient →]` returns to Today with the next appointment highlighted.

### 4.5 Prescriptions

- Filter chips: Drafts (default if any exist) · Approved · All. Working search.
- Row: RX id · pet · date · n medicines · status text.
- Tap → full-screen document view (print-ready), actions in the bottom bar: Print, Share, Edit (drafts only).
- Remove the inline "preview of first prescription" below the table.

### 4.6 Appointments

- Day view only on mobile, date swipeable left/right (Prev/Next actually work). Week view on desktop.
- Status is tappable: Upcoming → Arrived → In consult → Done.
- New appointment sheet: patient search (real list, not 5 hard-coded), date picker, time, reason chips (Follow-up, Vaccination, Checkup, Consultation). Owner auto-fills from the patient.

### 4.7 Reports & Settings

- Reports: only real derived counts (consultations this week, prescriptions approved, follow-ups due). No "34 min saved" invented metrics.
- Settings: clinic name/address/phone/doctor name (used on prescription documents, persisted), "Clear demo data". Remove non-functional tabs and toggles.

---

## 5. Components (the whole kit)

Keep it small; build in plain CSS modules or Tailwind — pick one (recommend **Tailwind v4 with these tokens as `@theme`**, delete hand-written classes as screens are migrated, delete unused `components/ui/*`).

| Component | Notes |
|---|---|
| `Button` | primary / secondary / ghost / danger; 44px min height; 48px for sticky bottom actions |
| `IconButton` | 44×44 hit area even if the glyph is 20px |
| `ListRow` | leading icon, title, subtitle, trailing meta/chevron; whole row is a `<button>` or `<a>` |
| `Sheet` | bottom sheet (mobile) / dialog (desktop); focus trap, Esc, drag-to-dismiss, `dvh` sizing |
| `TabBar` | mobile bottom nav with safe-area padding |
| `Chips` | single/multi select, horizontal scroll |
| `Field` | label above, 16px input, correct `type`/`inputMode`/`autoComplete`, error text below |
| `Status` | dot + text, three tones (ok / warn / neutral) |
| `Wave` | the recorder wave (SVG, transform only) |
| `Toast` | one system (sonner), only for saves/approvals/errors |
| `Empty` | one line of text + optional action; no illustration |

---

## 6. Performance budget

| Item | Budget |
|---|---|
| Initial JS | ≤ 90 KB gzip |
| Initial CSS | ≤ 15 KB gzip |
| Fonts | 0 bytes (system) |
| Third-party scripts | 0 on app routes |
| LCP on Moto G-class / 4G | ≤ 2.0 s |
| INP | ≤ 150 ms |
| CLS | 0 |

Tactics: remove unused providers (tRPC/React Query until a real API exists), lazy-load Appointments/Reports/Settings/Prescription document, keep recorder timer local, memo list rows, avoid `backdrop-filter` on scrolling bars.

---

## 7. What stays vs. what changes

| Stays | Changes |
|---|---|
| Forest green brand, product name, logo concept (simplified) | Palette trimmed to 1 brand + 3 status colours |
| Module set (Patients, Consultations, Prescriptions, Appointments, Reports, Settings) | Inventory hidden; Dashboard → Today |
| Data model in `Home.tsx` types | Derived stats/IDs/dates; new routes |
| 4-step consultation flow | Patient picked first; record button in thumb zone; Done step added |
| Desktop sidebar + split patient view | Mobile gets bottom tabs + list→detail screens |
| Notes fields and medicine fields | Medicine editing via compact rows + chip sheet |
| Demo-data persistence | Versioned key, resumable drafts, "Clear demo data" |

---

## 8. Implementation order

1. **Foundations** — tokens, type scale, viewport fix, focus/reduced-motion, remove dead providers & analytics, gate debug/bearer code. *(low risk, big mobile win)*
2. **Routing + state** — real routes, persisted consultation drafts, split `Home.tsx` into `views/` with colocated state.
3. **Shell** — mobile tab bar, search overlay, simplified sidebar.
4. **Today + Patients** — new order, list-first, patient record screen.
5. **Consultation** — picker, recorder with wave, notes, prescription rows/sheet, Done.
6. **Prescriptions / Appointments / Settings** — wire or remove every dead control.
7. **Cleanup** — delete unused `components/ui`, `ComponentShowcase`, unused deps; verify budget.

Each step ships on `frontend-edits` as its own commit and is checked at 375px and 1280px before moving on.
