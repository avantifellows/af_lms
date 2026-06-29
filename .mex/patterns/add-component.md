---
name: add-component
description: Add a React component with its colocated Vitest + Testing Library test. Use when building any UI under src/components or a page's client component.
triggers:
  - "add component"
  - "new component"
  - "react component"
  - "client component"
  - "add ui"
edges:
  - target: context/conventions.md
    condition: for naming, structure, and the verify checklist
  - target: context/stack.md
    condition: for the testing stack (Vitest + RTL) specifics
  - target: context/permissions.md
    condition: when the component imports shared constants (use @/lib/constants, not @/lib/permissions)
last_updated: 2026-06-25
---

# Add a React Component

## Context
Components live in `src/components/` (feature subfolders: `visits/`, `curriculum/`,
`performance/`, `quiz-sessions/`, `enrollment/`, `documents/`, `ui/`). PascalCase files,
colocated `*.test.tsx`. Reusable primitives are in `src/components/ui/` and visit form
inputs (`RadioPair`, `RemarkField`, `FormLabel`). Test stack: Vitest + `@testing-library/react`
+ jsdom (`vitest.config.ts`, `src/test-setup.ts`).

## Steps
1. Create `src/components/<area>/<Name>.tsx`. Add `"use client"` only if it uses state/effects/events.
2. Reuse `ui/` primitives and theme tokens (Tailwind v4) — don't hand-roll buttons/cards or hardcode colors.
3. Client mutations call internal API routes via `fetch` (never `query()` or `@/lib/db`).
4. For shared constants (e.g. `PROGRAM_IDS`) import from `@/lib/constants` — NOT `@/lib/permissions` (server-only).
5. Create colocated `<Name>.test.tsx`: render with RTL, use `@testing-library/user-event`, assert behavior. Mock modules with `vi.mock`; stub network with `vi.stubGlobal("fetch", ...)`.
6. Run `npm run test:unit:watch` while iterating; `npm run lint` before done.

## Gotchas
- **Never import `@/lib/db`** (or anything transitively pulling the pool) into a client component — it breaks the build/leaks server code.
- **Constructor/`new`-able mocks** need `vi.fn(function(){ return {...} })`, not arrow functions.
- **Variables used inside a `vi.mock()` factory** must be wrapped in `vi.hoisted()` (the factory is hoisted above `const`s).
- **Fake timers + async rendering**: call `vi.useFakeTimers()` AFTER `await ServerComponent(props)` + `render(jsx)`; use `fireEvent` not `userEvent`, wrap advances in `act(async () => await vi.advanceTimersByTimeAsync(n))`; don't pair `waitFor` with fake timers.
- **GPS state machines** (visit forms): mock `@/lib/geolocation` (`getAccurateLocation`/`getAccuracyStatus`); hold the fetch promise open to observe intermediate states (see `src/components/visits/AGENTS.md`).

## Verify
- [ ] PascalCase filename; colocated `*.test.tsx` exists and passes.
- [ ] No server-only import (`@/lib/db`) reachable from the client component.
- [ ] Reuses `ui/` primitives + theme tokens; no hardcoded colors.
- [ ] Network goes through `fetch` to internal API routes.
- [ ] `npm test` + `npm run lint` clean.

## Debug
- "Cannot use import statement"/pool errors in a test → a server-only module leaked in; mock or move it.
- Test hangs → fake-timer ordering (see gotcha); ensure timers start after async render.
- Act warnings → wrap state-changing interactions in `act`/`await` or use `user-event`.

## Update Scaffold
- [ ] If a new reusable primitive or test idiom emerged, note it in `context/conventions.md` or here.
