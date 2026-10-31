# VetFlow AI — Implementation & Design Plan

## Scope and implementation approach

VetFlow AI will be delivered as a frontend-first React/TypeScript SaaS dashboard in the initialized web-db-user project. The first release is a polished pilot demo using realistic in-memory seed data with localStorage persistence; it will not require paid AI APIs, authentication, a database, or a backend to demonstrate the core experience. The app will model the requested veterinary workflows in a single responsive shell: dashboard, patient directory and profile, voice consultation simulation, editable clinical documentation, prescription review/approval, consultation history, appointments, inventory preview, reports, and settings.

The primary demo path is: open Bruno → start consultation → simulate recording/stop → show transcription → review and edit clinical notes → review fictional prescription → approve → surface the completed consultation in Bruno’s history. All meaningful actions provide toast feedback, and additions/edits are retained across refreshes through localStorage.

The implementation will keep the supplied Express/tRPC/Drizzle helpers untouched unless a compile issue requires a minimal adjustment. The frontend will use React state, wouter-style client navigation, lucide-react icons, Tailwind CSS plus custom CSS tokens, and browser APIs where useful. The voice flow uses a functional timer and simulated waveform, with an optional MediaRecorder attempt and a deterministic demo transcription fallback. PDF/print affordances will use a print-friendly prescription view and browser print, without blocking the demo on a PDF service.

## Project structure

- `client/src/App.tsx`: application shell, route/view state, persistence wiring, modal/drawer coordination.
- `client/src/pages/Home.tsx`: primary dashboard application UI and reusable view renderers for the major modules.
- `client/src/index.css`: VetFlow visual system, responsive layout, cards, tables, forms, badges, motion, and mobile navigation rules.
- `client/public/manus-routes.json`: route manifest for the dashboard shell and module paths.
- `app.config.ts`: platform logo metadata.
- `plan.md`, `TODO.md`: approved implementation/design decisions and acceptance outcomes.

## Design direction

Three candidate styles (sampled from the requested healthcare/SaaS design tails):

1. **Clinical Signal** — quiet hospital-grade UI with strong green navigation and compact clinical data density (0.07).
2. **Botanical Ledger** — warm, editorial veterinary records with soft organic accents and generous whitespace (0.04).
3. **Ops Console** — high-contrast command-center dashboard with sharper geometry and operational emphasis (0.06).

Chosen style: **Clinical Signal**.

### Design Movement
Clinical Signal is a modern healthcare SaaS aesthetic: calm, precise, trustworthy, and operationally clear, borrowing the information hierarchy of premium EHR products with the restraint of Linear and Stripe.

### Core Principles
1. **Clinical clarity:** Every screen answers what needs attention now, what is complete, and what happens next.
2. **Quiet confidence:** Deep forest green carries authority; mint and soft neutrals create a humane, non-alarming environment.
3. **Action proximity:** High-value actions such as New Consultation and Approve Prescription stay one tap away from the relevant record.
4. **Respectful density:** Tables and timelines remain information-rich while preserving whitespace, readable type, and clear focus states.

### Color Philosophy
The signature forest green suggests care, stability, and clinical competence without looking sterile. Soft mint is reserved for success, progress, and AI processing moments. Off-white provides a calm canvas; warm graphite text avoids the harshness of pure black. Amber and coral are used sparingly for attention and risk, never as decoration.

### Layout Paradigm
Use a persistent left rail on desktop and a compact bottom/mobile navigation on smaller screens. The content area is a wide, asymmetric workspace: a clear page header and primary action sit above stacked cards, while important detail panels open as drawers or replace the main view. The dashboard uses a dominant today panel beside a quick-action rail rather than a uniform card grid.

### Signature Elements
- A small leaf-and-paw VetFlow mark built from CSS shapes and lucide PawPrint/Activity icons.
- Mint “signal” accents for AI-generated or successfully completed states.
- Timeline rails and waveform bars that visually connect care history with voice documentation.

### Interaction Philosophy
Interactions should feel like progressing a medical record: select, review, approve, and preserve. Use explicit button labels, immediate toast confirmations, editable fields with visible source badges, and no destructive action without context. Hover elevation and focused borders are subtle; dialogs/drawers should feel anchored to the originating record.

### Animation
Use only purposeful transitions: 160–220ms fades/slides for view changes and drawers, a slow pulse on recording/processing states, and staggered waveform bars while recording. Avoid decorative parallax or continuous motion on static screens. Respect reduced-motion preferences.

### Typography System
Use Inter as the primary family with system fallbacks. Page titles use 28–32px, 700 weight; section titles 16–18px, 650; body copy 13–15px; metadata 11–12px, 600 uppercase or letter-spaced only when it improves scanning. Numbers in stat cards use a strong 24–28px weight with tabular alignment.

### Brand Essence
**The voice-to-record companion for modern veterinary teams, turning every consultation into an organized, reviewable medical record.** Personality: dependable, humane, intelligent.

### Brand Voice
Headlines are concise and care-centered; CTAs are direct and reassuring. Example lines: “Turn today’s conversations into better records.” and “Review before it becomes part of the chart.”

### Wordmark & Logo
The wordmark pairs a compact leaf-and-paw mark with the “VetFlow” name and a small AI signal dot. In the sidebar, the mark stands alone when collapsed; in the mobile header, it anchors the product name and clinic context.

### Signature Brand Color
`#145c4a` — a deep evergreen that owns the interface without reading as generic teal.

## Build workflow

1. Replace starter page content with the VetFlow app shell and core workflows.
2. Add responsive route manifest and platform logo metadata.
3. Register TypeScript diagnostics through the managed Webdev config and resolve actionable diagnostics.
4. Start the configured preview service on port 3000; run typecheck/build checks.
5. Use a read-only implementation review against this plan and TODO, then fix any confirmed issues.
6. Commit the finished work to the canonical `main` remote so Webdev records the checkpoint; publish only if explicitly requested later.
