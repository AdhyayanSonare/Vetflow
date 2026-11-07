---
name: vetflow-ui
description: Design and implementation rules for Vetflow screens (Astraon brand tokens, fonts, sentence case, 44px touch targets, responsive phone/tablet/desktop layouts, shared components, accessibility, e2e checks). Use when creating or changing any page, dialog or component under client/src.
---

# Vetflow UI

Vets and pharmacists use this on phones in a busy clinic and on desks. It must be fast to scan, hard to misuse, and calm.

## Brand

The look follows astraonlabs.com: dark near-black surfaces (`#05090c`), mint accent (`#3ce3a8`), pill-shaped buttons, rounded cards, soft hairline borders. Dark is the default theme; light is a quiet companion.

- Tokens live in `client/src/styles/index.css` as CSS variables, mapped in `@theme inline`. Use semantic Tailwind classes (`bg-background`, `text-muted-foreground`, `border-border`, `text-danger`, `bg-danger-tint`, `text-primary`). **No hard-coded hex values** in components.
- Fonts: Bricolage Grotesque for headings, Geist for text, Geist Mono for numbers and codes (use the `num` class so figures align). Self-hosted through `@fontsource-variable`; no CDN. These match astraonlabs.com.
- The wordmark is text only (`app/layout/Wordmark.tsx`). No logos, no illustrations, no emoji in the UI.
- Voice: **sentence case**, plain words, say what will happen ("Dispense 2 packs") not "Submit". Errors say what went wrong and what to do next.
- Dates in India time (`dateIST`, `dateTimeIST` in `lib/format.ts`); money from paise (`money`, `rupeesText`).

## Responsive rules (tested by `e2e/smoke.spec.ts` at 375, 768, 1280)

- Phone (< 768): bottom tab bar with four role-based tabs, a centre **Record** button, and **More**. Tablet (768-1023): icon rail. Desktop: sidebar.
- No horizontal page scroll at 375 px. Tables become cards (`DataTable` handles it); long text wraps.
- Touch targets at least **44 px** (buttons, links in lists, checkbox rows). Inputs are 16 px so iOS does not zoom. Text never below 12 px.
- Dialogs: `ResponsiveDialog` (bottom sheet on phones, centred dialog above). Never a raw modal.
- Respect `prefers-reduced-motion`. Focus is always visible. Everything works with the keyboard.

## Building blocks (use them, do not re-make them)

`components/common`: `Page`/`PageHeader`/`Section`, `DataTable`, `StatusBadge`, `Stat`, `SearchInput`, `Fields` (`TextField`, `NativeSelect`, `TextAreaField` with label, hint and error wired for screen readers), `ResponsiveDialog`/`DialogActions`, `States` (loading, empty, error), `useConfirm()`.
`components/ui`: the small shadcn/Radix subset. Add a primitive there only if a second use appears.

## Structure of a feature

```
features/<area>/
  api.ts            types + TanStack Query hooks (the only place that calls api.get/post)
  <Area>Page.tsx    layout and wiring only
  <Thing>Dialog.tsx forms (react-hook-form + zod where there are several fields)
  logic.ts          pure functions, unit-tested (*.test.ts)
```

- Server data lives in TanStack Query. After a stock change call `useInvalidateStock()`. Do not copy server data into local state or `localStorage`.
- Every page handles loading, empty, error and "no permission" states. Use `States`.
- Show server errors with `errorMessage(e)`; never render a stack trace or raw JSON.
- **Confirm before anything that changes stock, approves, cancels, deletes or sends** with `useConfirm()`; the text states the consequence.
- Manual entry is first-class. Voice and barcode are enhancements behind tenant flags; the screen must be complete without them.
- Clinical text from voice is shown verbatim and is never saved as final. The vet writes or confirms.

## Checklist before you finish

1. Looks right at 375, 768 and 1280 (use the Chrome tools or `pnpm e2e`; screenshots land in `docs/qa/`).
2. Added the route to `app/Router.tsx` (with `permission` if restricted) and to the smoke test list.
3. `pnpm check` and `pnpm e2e` pass; no `any`, no `console.log`.
4. Words read like a person wrote them for a vet or a pharmacist, not a developer.
