# UI Improvements Plan — CRUD UI

> **Status:** Draft
> **Branch:** `ui-improvements`
> **Current Style Reference:** `docs/UI-Style-Guide.md` (Ledger UI / Corporate Brutalist / Emerald Light Mode)

---

## Problem Statement

The CRUD UI is functional but feels empty and cold. The existing `UI-Style-Guide.md` — a "Corporate Brutalist" design system ported from a different product (ADS Agrotech, an inventory/ledger app) — is the root cause. Even when mostly followed, its principles produce a sparse, lifeless UI:

- **No shadows + sharp corners + thin borders** = cards that look like empty rectangles with no depth
- **Single emerald accent** on an almost-white background (`#F0F7F4`) = washed-out, no visual richness
- **Uppercase everything** = institutional/clinical tone, wrong for a tool PMs use on phones during school visits
- **"Minimal shadows" as a philosophy** = nothing feels clickable or interactive

The fix is not "apply the style guide more consistently" — it's **rethink the design direction** for this product's actual context: school administrators and program managers doing field work, often on mobile.

---

## Technical Notes

- **Tailwind v4 theme configuration:** All color, font, and spacing changes go in the `@theme inline` block in `src/app/globals.css`. There is no `tailwind.config.ts` — this is the Tailwind v4 approach. Developers unfamiliar with v4 should look here, not for a config file.
- **Icon library:** Use `lucide-react` for all icons. It's lightweight, tree-shakeable, and the standard choice for Next.js apps. Replace inline SVGs in all files (currently 13 files — grep for `<svg` to get the latest list): Pagination, SchoolSearch, StudentSearch, PageHeader, EditStudentModal, TopicRow, StudentTable, `school/[udise]/page.tsx`, `admin/users/page.tsx`, `admin/users/AddUserModal.tsx`, `admin/schools/page.tsx`, `admin/schools/SchoolList.tsx`, and `app/page.tsx` (login).
- **Z-index scale:** `z-10` for sticky bars (e.g., visit form progress bars), `z-40` for secondary modals (e.g., ActionTypePickerModal, delete confirmations), `z-50` for primary modals and toasts. If a shared `<Modal>` component is created, standardize primary modals to `z-50` there.
- **Font loading:** Inter is not currently loaded. The CSS variable `--font-geist-sans` in `globals.css` falls back to `Arial, Helvetica, sans-serif`. Fix steps:
  1. Import `Inter` from `next/font/google` in `src/app/layout.tsx`
  2. Rename the CSS variable from `--font-geist-sans` to `--font-inter` (or similar semantic name)
  3. Apply the font class to the `<body>` element in `layout.tsx`
  4. No per-component changes needed — 0 inline `fontFamily` declarations exist
  5. **Remove or update the hardcoded `font-family: Arial, Helvetica, sans-serif` on the `body` rule in `globals.css` line 72** — replace with `font-family: var(--font-inter)` or remove entirely so the theme variable takes effect. Without this step, the hardcoded rule will override the Inter font and the font change will silently fail.

---

## Pages & Components Inventory

Every page and component in the app, with scope status. **All items marked "In scope" must be addressed for visual consistency.**

### Pages

| Page | Route | Scope | Notes |
|------|-------|-------|-------|
| Login | `/` | In scope | First user impression. Uses standard Tailwind (gray-50, blue-600). |
| Dashboard | `/dashboard` | In scope | School card grid, stat cards, search bars. Mix of design tokens and Tailwind. |
| School Detail | `/school/[udise]` | In scope | Tab bar, student list, enrollment cards. |
| New Visit | `/school/[udise]/visit/new` | In scope | GPS capture flow for starting visits. |
| Visits List | `/visits` | In scope | Filter form, visit table. |
| Visit Detail | `/visits/[id]` | In scope | Header card, action point list, complete button. |
| Action Detail | `/visits/[id]/actions/[actionId]` | In scope | Dispatches to form components. Has own header/layout styling. |
| Admin Hub | `/admin` | In scope | 3 card links. Uses standard Tailwind (bg-white shadow). Used daily by program admins. |
| Admin Users | `/admin/users` | In scope | Full user CRUD with table, modals, action buttons. |
| Admin Batches | `/admin/batches` | In scope | Batch metadata editing. |
| Admin Schools | `/admin/schools` | In scope | School program assignment. |
| Performance Tab | (tab within school detail) | In scope | Program pills, grade selector, empty state. |

### Visit Form Components (highest complexity, most frequently used)

PMs interact with these during every school visit — they are the most visually dense and mobile-critical parts of the app. All use custom design tokens (`bg-bg-card`, `text-text-primary`, `border-border-accent`).

| Component | File | Scope | Notes |
|-----------|------|-------|-------|
| ClassroomObservationForm | `src/components/visits/ClassroomObservationForm.tsx` | In scope | Rubric scoring, teacher select, multi-section. Most complex form. |
| AFTeamInteractionForm | `src/components/visits/AFTeamInteractionForm.tsx` | In scope | Teacher multiselect + 9 binary questions. |
| IndividualAFTeacherInteractionForm | `src/components/visits/IndividualAFTeacherInteractionForm.tsx` | In scope | Per-teacher accordion, attendance gating. |
| PrincipalInteractionForm | `src/components/visits/PrincipalInteractionForm.tsx` | In scope | 7-question checklist. |
| GroupStudentDiscussionForm | `src/components/visits/GroupStudentDiscussionForm.tsx` | In scope | Grade-scoped checklist. |
| IndividualStudentDiscussionForm | `src/components/visits/IndividualStudentDiscussionForm.tsx` | In scope | Per-student dropdown + questions. |
| SchoolStaffInteractionForm | `src/components/visits/SchoolStaffInteractionForm.tsx` | In scope | 2-question checklist. |

### Supporting Visit Components

| Component | File | Scope |
|-----------|------|-------|
| ActionPointList | `src/components/visits/ActionPointList.tsx` | In scope |
| ActionTypePickerModal | `src/components/visits/ActionTypePickerModal.tsx` | In scope |
| CompleteVisitButton | `src/components/visits/CompleteVisitButton.tsx` | In scope |
| NewVisitForm | `src/components/visits/NewVisitForm.tsx` | In scope |
| ActionDetailForm | `src/components/visits/ActionDetailForm.tsx` | In scope |

### Shared UI Components

| Component | File | Scope |
|-----------|------|-------|
| SchoolCard | `src/components/SchoolCard.tsx` | In scope |
| StatCard | `src/components/StatCard.tsx` | In scope |
| PageHeader | `src/components/PageHeader.tsx` | In scope |
| SchoolSearch | `src/components/SchoolSearch.tsx` | In scope |
| StudentSearch | `src/components/StudentSearch.tsx` | In scope |
| Pagination | `src/components/Pagination.tsx` | In scope |
| EditStudentModal | `src/components/EditStudentModal.tsx` | In scope |
| StudentTable | `src/components/StudentTable.tsx` | In scope |
| SchoolTabs | `src/components/SchoolTabs.tsx` | In scope |
| LoadingLink | `src/components/LoadingLink.tsx` | In scope |
| Toast | `src/components/Toast.tsx` | In scope | `role="alert"`, z-50 positioning, own color scheme. Used by ActionDetailForm. |

### Admin Sub-Components

| Component | File | Scope | Notes |
|-----------|------|-------|-------|
| AddUserModal | `src/app/admin/users/AddUserModal.tsx` | In scope | Multiple `text-blue-600` usages on checkboxes and links (lines 256, 278, 311, 361) — needs migration to accent color |
| SchoolList | `src/app/admin/schools/SchoolList.tsx` | In scope | `text-blue-600` on stats, edit button, and checkboxes (lines 130, 222, 275) — needs migration to accent color |
| UserList | `src/app/admin/users/UserList.tsx` | In scope | 4 role badge color schemes (purple/cyan/indigo/gray), level badges (`bg-blue-100 text-blue-800`), program badges, action buttons with `bg-blue-600 hover:bg-blue-700`, multiple `text-blue-600` usages. Role/program badge colors are semantic (see Section B exception). |
| BatchList | `src/app/admin/batches/BatchList.tsx` | In scope | Stream badges (`bg-blue-100 text-blue-800`), grade badges (`bg-green-100 text-green-800`), edit/save/cancel links with hardcoded colors, input focus styles with `focus:border-blue-500`. |

### Curriculum Components (Out of Scope)

The `src/components/curriculum/` directory contains 6+ components (TopicRow, ChapterAccordion, LogSessionModal, CurriculumTab, etc.) with their own styling and test files. **These are out of scope** — curriculum is a separate POC feature and will be styled in a future pass. Note: ChapterAccordion.test.tsx and LogSessionModal.test.tsx have CSS class assertions that may break (listed in P0-F).

---

## Current State Audit

The codebase is **not** uniformly styled. Two different color systems are mixed together.

### Migration Scope

Quantitative breakdown of the two color systems:
- **Standard Tailwind colors:** ~491 instances across 37 files (~58% of color usage)
- **Design token colors:** ~350 instances across 23 files (~42% of color usage)

Standard Tailwind outnumbers design tokens, but admin pages, dashboard, and login are small pages with low migration effort.

### Color System Fragmentation

| Area | Color System | Example Classes |
|------|-------------|-----------------|
| Visit form components | Custom design tokens | `bg-bg-card`, `text-text-primary`, `border-border-accent`, `accent-accent` |
| PageHeader | Custom design tokens | `bg-bg-card`, `text-text-primary`, `text-accent`, `border-accent` |
| Dashboard (recent visits table) | Custom design tokens | `bg-bg-card`, `bg-bg-card-alt`, `border-border`, `text-text-primary` |
| SchoolCard | Standard Tailwind | `bg-white rounded-lg shadow p-6 hover:shadow-md`, `text-gray-900`, `text-gray-500` |
| StatCard | Standard Tailwind | `bg-gray-50 rounded-lg p-4`, `text-gray-500`, `text-gray-900` |
| Login page | Standard Tailwind | `bg-gray-50`, `bg-white shadow-lg`, `text-gray-900`, `border-gray-300`, `bg-blue-600` |
| Admin pages | Standard Tailwind | `bg-white shadow`, `text-gray-900`, `text-gray-500` |
| Pagination | Standard Tailwind + blue | `bg-blue-600` (active page), `ring-1 ring-inset ring-gray-300` — third color pattern, neither design tokens nor standard gray |
| Student table / search | Standard Tailwind + blue | `text-blue-600`, `bg-red-600`, `text-gray-900` |

### Actual Component State (correcting plan assumptions)

- **SchoolCard** already has `rounded-lg shadow hover:shadow-md` — it is NOT "flat with no shadow"
- **StatCard** already has `rounded-lg` — it is NOT "sharp corners"
- **Login page** already has decent card styling (`rounded-lg shadow-lg`) — needs palette alignment, not a redesign
- **Admin pages** already use `rounded-lg shadow hover:shadow-md` on cards
- **Visit forms** use `border border-border` sections with no shadows — these DO need shadow/elevation treatment
- **Dashboard** mixes both systems — recent visits table uses design tokens, stat cards use standard Tailwind

### Current Design Token Palette (from globals.css)

```
Accent:     #059669 (emerald-600)
Accent hover: #047857 (emerald-700)
Background: #F0F7F4 (light mint)
Card:       #FFFFFF (white)
Card alt:   #F5FAF7 (subtle mint)
Input bg:   #FFFFFF (white)
Hover bg:   #E6F2EC (mint hover)
Border:     #D1E7DD (mint border)
Border accent: #059669 (accent border)
Text primary: #2A2A2A (near black)
Text secondary: #6B6560 (warm gray)
Text muted: #9A948D (lighter gray)
Text on accent: #FFFFFF (white)
Danger:     #ef4444 (red-500)
Danger bg:  rgba(239, 68, 68, 0.08)
Success bg: rgba(5, 150, 105, 0.08)
Warning bg: #fef3c7
Warning border: #fcd34d
Warning text: #92400e
```

---

## Design Direction: What Needs to Change

### A. The style guide needs a new design language

The "Corporate Brutalist" language is wrong for this product. A better direction would be something like **"Warm Professional"** or **"Friendly Data"**:

- **Rounded corners** (subtle, `rounded-lg`) instead of sharp edges — approachable, modern
- **Soft shadows** (`shadow-sm`, `shadow-md`) for depth and card separation
- **Hover/press states** on all interactive elements — things should feel alive
- **Warmer palette** — keep emerald as accent but add warmth to backgrounds, consider a secondary accent color
- **Mixed-case headings** — title case or sentence case, not ALL CAPS everywhere
- **Larger touch targets** — minimum 48px (Google/Apple standard) for all interactive elements

### B. The color system needs more range AND unification

Current: two separate color systems (design tokens AND standard Tailwind) used inconsistently across the app.

Needed:
- **Unify on a single color system** — all components should use the same approach (design tokens in the `@theme inline` block). **Exception:** Semantic category colors (program badges in SchoolList `PROGRAM_COLORS`, role badges in UserList, level badges) retain distinct Tailwind colors since each color conveys a different category. The "unify on tokens" guidance applies to accent, background, text, and status colors — not categorical badges where color carries meaning.
- A richer background that actually contrasts with cards (or white background with colored cards)
- A secondary accent for variety (e.g., amber for warnings/counts, blue for info)
- Status colors that feel intentional, not afterthoughts
- Better use of the emerald — it should highlight, not be the only non-gray color

**Color palette to be defined in P0 "Design Exploration" task** (see Implementation Priority below). At minimum, the following must be specified before any implementation begins:
- Primary accent (currently #059669 emerald — keep, adjust, or replace?)
- Secondary accent (new — for info states, variety)
- Background color (currently #F0F7F4 mint — too washed out?)
- Card background
- Text hierarchy colors (primary, secondary, muted)
- Status colors (success, warning, danger, info)
- All values as hex codes in the `@theme inline` block

### C. Typography needs warmth

Current: uppercase + tracking-wide everywhere = cold ledger feel.

Needed:
- Reserve uppercase for small labels and badges only — **note:** `uppercase` currently appears in ~96 places across 21 files (visit forms, tabs, tables, column headers, labels, buttons, page files), not just section headers. When touching any component, convert `uppercase` to sentence/title case. Track progress by grepping for remaining `uppercase` instances.
- Use sentence/title case for headings
- Actually load Inter (see Technical Notes above for specific fix steps)
- More font weight variation to create hierarchy without shouting

---

## Prerequisites (P0 — Before Any Page Work)

These must be completed before per-page styling begins.

### P0-A: Design Exploration

Define the concrete color palette (hex values for all tokens listed in Section B above). Update the `@theme inline` block in `globals.css` with the new values. This is a blocker — without specific colors, implementers will improvise and create inconsistency.

**Note:** All `accent-accent` usages (16 instances across 8 files) reference the `--color-accent` CSS custom property and auto-update when the palette changes — no manual changes needed for those.

**Accessibility requirements for the palette:**
- Validate all text colors against WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text). Current `text-muted` (`#9A948D`) has ~3.0:1 contrast on white — fails AA. Choose a darker muted color.
- Touch targets: use padding/min-height on interactive wrappers (not larger radio buttons) to reach 48px. Define this approach in the shared Input component.
- Focus rings: apply globally via a Tailwind base layer rule (`@layer base { :focus-visible { ... } }`) rather than per-component for maintainability.

### P0-B: Remove Focus Ring CSS Override

`globals.css` (lines 60-67) globally disables all focus rings with `!important`:
```css
input:focus, input:focus-visible,
select:focus, select:focus-visible,
textarea:focus, textarea:focus-visible,
button:focus, button:focus-visible,
a:focus, a:focus-visible {
  outline: none;
  --tw-ring-shadow: 0 0 #000 !important;
}
```
**This blocks all focus ring styling work.** Remove this block and replace with the desired focus ring approach (e.g., `focus:ring-2 focus:ring-accent/50 focus:ring-offset-1`).

**Additionally:** After removing the global override, grep for `focus:ring-blue` and `focus:border-blue` across all files and migrate them to `focus:ring-accent` / `focus:border-accent`. At least 10 components have hardcoded blue focus rings: AddUserModal, BatchList, Login page (`src/app/page.tsx`), QuizAnalyticsSection, StudentTable, LogSessionModal, CurriculumTab, StudentSearch, SchoolSearch, and EditStudentModal. Components that adopt the shared `<Input>` (P0-E) will get accent-colored focus rings automatically; others need manual updates.

### P0-C: Load Inter Font

Follow the steps in Technical Notes above. This is a 2-file change (`layout.tsx` + `globals.css`).

**Additionally:** Update `docs/UI-Style-Guide.md` font references from Rajdhani to Inter, or add a note at the top marking the font section as superseded. The style guide currently has 5 font-face declarations for Rajdhani as the primary font (it already mentions Inter as an option).

### P0-D: Install lucide-react

```bash
npm install lucide-react
```

### P0-E: Create Shared Components

Create shared components to avoid massive repetitive changes across 24+ files (~82 `<button` instances across the codebase; migrate per-page, not all at once):

1. **`<Button>`** — currently buttons are inline `<button className="...">` across 24+ files with inconsistent styling. A shared Button with variants (primary, secondary, ghost, danger) means styling changes happen once.
2. **`<Card>`** — card styling is duplicated across SchoolCard (`bg-white rounded-lg shadow p-6`), StatCard (`bg-gray-50 rounded-lg p-4`), modals (`rounded-lg bg-white p-6 shadow-xl`), admin cards, etc. A shared Card wrapper unifies this.
3. **`<Input>`** — input styling varies between SchoolSearch, StudentSearch, visit filter forms, and visit form components. A shared Input normalizes this. Should use accent color for focus rings (not blue).
4. **`<Badge>`** — grade badges, status badges, program pills all use different inline styles.
5. **`<Modal>`** — 7 modals in the app use two incompatible styling approaches. 6 modals (AddUserModal, EditStudentModal, LogSessionModal, SchoolList inline modal, StudentSearch, ActionPointList) use hardcoded `fixed inset-0 z-50` + `bg-black bg-opacity-30` + `bg-white shadow-xl`. 1 modal (ActionTypePickerModal) uses design tokens and `z-40`. A shared Modal component (backdrop + card wrapper) standardizes z-index, backdrop, and card styling across all 7.
6. **`<StickyProgressBar>`** — identical sticky progress bar markup (`sticky top-12 z-10 border-2 border-border-accent bg-bg-card-alt px-3 py-2`) appears in 7 of 9 visit form files. Extract once to avoid 7 identical updates.
7. **`<FormSection>`** — the `border border-border p-4 space-y-4` section wrapper is repeated in every visit form. A thin wrapper deduplicates this. **Must accept an optional `className` prop** (or `spacing` prop) so ClassroomObservationForm can override the default `space-y-4` spacing — that form uses `border border-border p-4` without `space-y-4` in most sections. Default to `space-y-4`.
8. **`<RadioPair>`** — `flex items-center gap-4` with `h-4 w-4 accent-accent` radio inputs repeated in 6+ visit forms. Extract to normalize styling and touch targets. **Design note:** The `onChange` callback prop should accept `onAnswer(questionKey, value)` so parent forms pass a simple prop rather than each defining their own `handleAnswerChange` handler. This moves some of the duplicated handler logic (currently in 6 form files with varying signatures) into the shared component API.
9. **`<RemarkField>`** — the "Add remark" toggle link that reveals a `w-full border-2 border-border px-3 py-2 text-sm` textarea appears in all 7 interactive visit forms. **Design note:** The `onChange` callback should follow the same `onRemark(questionKey, value)` pattern as `<RadioPair>` to reduce handler duplication in parent forms.

10. **`<Select>`** — 21 `<select>` elements across 12 files. Visit form selects share identical styling (`border-2 border-border px-3 py-2 text-sm focus:border-accent`). A shared Select component normalizes this. (Note: `<select>` cannot be rendered as `<input>` — this is a separate component from `<Input>`.) **Must include `disabled:cursor-not-allowed disabled:bg-bg-card-alt`** to match textarea/input disabled behavior — current `<select>` elements have no disabled state styling at all.

11. **`<FormLabel>`** — The class string `mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted` is repeated identically in 8 form files (10 files with partial match). A thin `<label>` wrapper component extracts this pattern so the typography change (removing `uppercase tracking-wide`) happens in one place instead of 8-10 separate edits.

12. **`isPlainObject` utility extraction** — The identical 3-line type guard function `isPlainObject` is copy-pasted into 8 visit form files (AFTeamInteractionForm, ClassroomObservationForm, GroupStudentDiscussionForm, IndividualAFTeacherInteractionForm, IndividualStudentDiscussionForm, PrincipalInteractionForm, SchoolStaffInteractionForm, ActionDetailForm). Extract to `src/lib/visit-form-utils.ts` and replace with a one-line import in each file. This reduces noise when restyling these forms.

These are NOT a component library — they're deduplication. Each is a thin wrapper around Tailwind classes. Without these, every visual change must be applied individually to every component, creating a massive diff and high risk of inconsistency.

**Directory:** Create all shared components in `src/components/ui/`.

**Client components:** All shared UI components must include `"use client"` since they handle events/hooks and are consumed by client components (34 existing components have `"use client"` directives).

**Component variants:**
- `<Input>`: `variant="default"` (design-token style for visit forms), `variant="admin"` (gray-300 rounded for admin forms), `variant="muted"` (card-alt background)
- `<Card>`: `elevation="sm"` (shadow-sm, subtle), `elevation="md"` (shadow, default), `elevation="xl"` (shadow-xl, modals)

**RemarkField state:** `<RemarkField>` should manage its own `isRevealed` toggle state internally to keep parent forms simple.

**Shared base input styling:** `<Input>`, `<Select>`, and `<RemarkField>` all share the same base styling pattern (`border-2 border-border px-3 py-2 text-sm focus:border-accent focus:outline-none`), used across 8 files for textareas, inputs, and selects. Define a shared `baseInputClasses` constant (e.g., in a `src/components/ui/styles.ts` file or co-located with the components) so visual consistency between form controls is maintained in one place. Each component adds its own element-specific classes on top of this base.

**Modal backdrop syntax:** The shared `<Modal>` should use `bg-black/30` (Tailwind v4 native syntax) instead of the legacy `bg-black bg-opacity-30`.

### P0-F: Audit and Update Unit Tests

**17 test files** have CSS class assertions that will break during restyling:

1. **StatCard.test.tsx** — 6 assertions (`text-2xl`, `text-lg`, `text-3xl`, `font-semibold`, `text-sm`, `text-gray-500`)
2. **SchoolCard.test.tsx** — querySelector for `.mt-4.flex.gap-2`
3. **SchoolTabs.test.tsx** — 5 assertions including `border-accent`, `text-accent`, `uppercase`, `font-bold`, `border-transparent`
4. **LoadingLink.test.tsx** — querySelector for `.animate-spin`, `toHaveClass("custom-class")`
5. **StudentTable.test.tsx** — badge class assertions, querySelector for `span.text-gray-700`
6. **TopicRow.test.tsx** — 7 assertions on checkbox colors (`border-gray-300`, `bg-white`, `bg-green-500`, `border-green-500`, `text-white`, `text-gray-700`, `text-gray-500`)
7. **LogSessionModal.test.tsx** — assertions on `bg-blue-100`, `line-through`, `text-gray-400`; also `.bg-opacity-30` modal backdrop selectors (lines 491/526/597)
8. **visit-actions.test.ts** — 14+ assertions on `statusBadgeClass()` output including design tokens (`bg-success-bg`, `text-accent-hover`, `bg-warning-bg`, `text-warning-text`, `bg-bg-card-alt`, `text-text-secondary`, `text-text-muted`)
9. **page.test.tsx** (`src/app/visits/[id]/actions/[actionId]/`) — asserts `toHaveClass("invisible")` — could break if visibility approach changes
10. **ChapterAccordion.test.tsx** (`src/components/curriculum/`) — asserts `text-yellow-500` and `rotate-90` — `text-yellow-500` could break if palette changes
11. **layout.test.tsx** (`src/app/`) — asserts `toContain("antialiased")` — unlikely to break but included for completeness
12. **PageHeader.test.tsx** — `querySelector("p.mt-1")` — breaks if spacing class changes
13. **SchoolList.test.tsx** — `querySelector(".bg-opacity-30")` — breaks when shared Modal changes backdrop
14. **AddUserModal.test.tsx** — `querySelector(".bg-black.bg-opacity-30")` — breaks when shared Modal changes backdrop
15. **EditStudentModal.test.tsx** — `querySelector(".bg-black")` — breaks when shared Modal changes backdrop
16. **StudentSearch.test.tsx** — `querySelector(".fixed.inset-0")` — breaks if modal layout classes change
17. **LogSessionModal.test.tsx** (additional) — `.bg-opacity-30` selectors break with new Modal backdrop

**Note:** Files 12-17 are particularly impacted by the shared `<Modal>` component (P0-E), which will change backdrop markup from `bg-black bg-opacity-30` to `bg-black/30` with potentially different class structures. Modal backdrop selectors are the main risk in these tests.

Notably, **SchoolTabs.test.tsx asserts on `uppercase`** — the typography change will break this test. And **visit-actions.test.ts** has 14+ assertions on design token class names — if tokens are renamed during palette unification, these break too.

Before starting per-page work:
1. Grep for `className` assertions across all test files to confirm the full list
2. Update tests to assert on behavior/semantics rather than specific CSS classes where possible
3. Update remaining CSS class assertions to match the new styling

---

## Per-Page Issues & Proposed Fixes

### 1. Header / Navigation

**Current:** Plain text title "Schools" with subtitle "Admin access", nav links as unstyled text, user email as a plain link. No logo or brand color in the header. PageHeader uses design tokens (`bg-bg-card`, `text-text-primary`, `border-accent`).

**Proposed:**
- Add Avanti Fellows logo or brand-colored top bar
- Style nav links as proper navigation with active/hover states, rounded pills or underline indicators
- Give the header a defined background with bottom shadow
- Compact user info / sign-out group on the right

### 2. Dashboard Stat Cards

**Current:** `bg-gray-50 rounded-lg p-4` with `text-gray-500` labels and dynamic size values. Uses standard Tailwind, not design tokens.

**Proposed:**
- Migrate to shared `<Card>` component with design tokens
- Monospace numbers for data values
- Consider a colored left border or lucide-react icon to differentiate metrics
- Condense into an inline stats bar if there are only 2-3 metrics

### 3. School Cards

**Current:** Already has `bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow`. Grade badges use `bg-gray-100 text-gray-700`. Bright green "START VISIT" button on every card = visual noise x 675.

**Proposed:**
- Cards already have shadow/rounding — focus on palette alignment (migrate from standard Tailwind to design tokens)
- Demote "START VISIT" to a secondary/ghost style using shared `<Button>` — it shouldn't scream on every card
- Style grade breakdowns as compact pills using shared `<Badge>` with `font-mono` numbers
- Increase school name prominence (larger, bolder)

### 4. Search Bars

**Current:** Two stacked full-width search bars (students + schools) — awkward and unclear. Uses standard Tailwind.

**Proposed:**
- Keep separate but lay out inline/compact with clear labels (combining into one is a functional change — out of scope)
- Migrate to shared `<Input>` component
- Rounded inputs with subtle focus ring (enabled by P0-B focus ring fix)

### 5. Visits Page — Filter Form

**Current:** Bordered box with inputs + "APPLY" button + "RESET" as a mismatched link. Wireframe feel.

**Proposed:**
- Remove outer border — use spacing to group
- Inline/horizontal filter layout on desktop
- Match "RESET" style to "APPLY" using shared `<Button>` variants (both buttons, different emphasis)

### 6. Visits Page — Section Headers

**Current:** "ALL VISITS" and "IN PROGRESS" in large bold ALL CAPS. Aggressive. Dashboard also has `uppercase tracking-wide` on headings.

**Proposed:**
- Title case, calmer font size
- Subtle accent border or background tint for section separation

### 7. Visit Detail Page

**Current:** "COMPLETE VISIT" floats disconnected between header and action points. Timestamps are tiny gray text. "View Details" is a plain bordered afterthought.

**Proposed:**
- Improve visual hierarchy of "COMPLETE VISIT" within the header card area (no sticky footer — that's a functional change)
- Action point cards with rounded corners, shadow, consistent padding
- "View Details" as a proper styled button using shared `<Button>`

### 8. School Detail — Student List

**Current:** "Edit" (blue) + "Dropout" (red) buttons on every student row. Red on every row is alarming.

**Proposed:**
- Subtler "Edit" style using shared `<Button>` ghost variant
- Reduce visual weight of "Dropout" — use danger ghost variant instead of solid red (keep it visible, not hidden — hiding it behind a menu is a functional change)
- Reduce overall visual weight of per-row actions

### 9. School Detail — Tab Bar

**Current:** Plain text tabs with thin green underline. Minimal visual weight.

**Proposed:**
- More prominent active state (background tint or bolder underline)
- Bottom border on the full tab bar for definition
- Slightly larger text with better spacing

### 10. Empty States (all pages)

**Current:** "Select a program to view performance data" in faint text. Program pills look like basic unstyled buttons.

**Proposed:**
- More prominent empty state message with a lucide-react icon
- Clear selected/unselected states on program pills (fill vs. outline) using shared `<Badge>`

### 11. Visit Form Components (NEW)

**Current:** All 7 form components use design tokens consistently (`border-border`, `bg-bg-card`, `text-text-primary`, `accent-accent`). Sections use `border border-border p-4`. No shadows on sections. Radio buttons use `h-4 w-4 accent-accent`. Textareas use `border-2 border-border`.

**Proposed:**
- Add subtle shadows to form sections for depth
- Ensure all form controls meet 48px minimum touch target on mobile
- Migrate radio buttons and textareas to use shared `<Input>` component, and selects to use shared `<Select>` component
- Ensure consistent spacing and padding across all 7 forms
- Progress bars (sticky top-12) should align with new color palette

### 12. Admin Pages (NEW)

**Current:** All admin pages use standard Tailwind (`bg-white shadow`, `text-gray-900`, `text-gray-500`). Admin hub cards already have `rounded-lg shadow hover:shadow-md`.

**Proposed:**
- Migrate from standard Tailwind to design tokens for color consistency with rest of app
- Use shared `<Card>` component for admin hub cards
- Use shared `<Button>` component for action buttons in user/school/batch management
- Align table styling with the design token approach used in dashboard recent visits table
- **Note:** `AddUserModal.tsx` and `SchoolList.tsx` have multiple `text-blue-600` usages (checkboxes, links, stats, buttons) that need migration to the accent color — see Admin Sub-Components inventory

### 13. Login Page (NEW)

**Current:** Already decent card styling (`rounded-lg shadow-lg`, `bg-gray-50` background). Uses blue accent (`bg-blue-600`) which is inconsistent with the rest of the app's emerald accent.

**Proposed:**
- Align button color with app's accent color (emerald, not blue)
- Migrate from standard Tailwind colors to design tokens
- Keep the existing card-based layout — it works well

---

## Mobile Requirements

PMs use this app on phones during school visits. Visit form components are the most mobile-critical parts.

### Minimum Touch Target: 48px

All interactive elements must meet the 48px minimum touch target (Google/Apple standard). Elements to audit:

- **Form radio buttons**: Currently `h-4 w-4` (16px) — need larger tap area (add padding or increase size)
- **Form select dropdowns**: Verify trigger area meets 48px
- **"Add remark" links** in visit forms: Small text links — need larger tap area
- **Action buttons** (Start, End, Delete) in ActionPointList
- **Tab bar items** in SchoolTabs
- **Pagination controls** in Pagination component
- **Grade selector pills** in performance tab and GroupStudentDiscussionForm
- **Student/teacher add/remove buttons** in individual interaction forms

### Mobile Layout

- Existing responsive grid (`sm:grid-cols-2 lg:grid-cols-3`) and progressive padding (`px-4 sm:px-6 md:px-16 lg:px-32`) are adequate
- Visit form components have no explicit mobile optimizations beyond basic responsiveness — ensure form sections stack cleanly on narrow screens
- Sticky progress bars in visit forms (`sticky top-12`) should be tested on mobile to ensure they don't obscure content

---

## Implementation Priority

| Priority | Item | Impact | Effort |
|----------|------|--------|--------|
| **P0** | Design exploration — define color palette (hex values) | Blocker — everything else follows. Complete all P0 before starting P1+. P1/P2/P3 indicate suggested order, not hard gates. | Low |
| **P0** | Remove focus ring CSS override (globals.css lines 60-67) | Blocker — enables all focus ring work | Low |
| **P0** | Load Inter font (layout.tsx + globals.css) | High — typography is foundational | Low |
| **P0** | Install lucide-react | Blocker — needed for icon work | Low |
| **P0** | Create shared components (Button, Card, Input, Select, Badge, Modal, StickyProgressBar, FormSection, RadioPair, RemarkField, FormLabel) + extract `isPlainObject` utility — in `src/components/ui/` and `src/lib/visit-form-utils.ts` | High — reduces diff size and prevents drift | Medium |
| **P0** | Audit/update unit tests with CSS class assertions | Blocker — prevents test failures during restyling | Low |
| **P0** | Header/nav bar redesign | High — first thing users see | Medium |
| **P0** | School cards polish (button tone-down, palette alignment) | High — main view | Medium |
| **P1** | Dashboard stat cards | Medium | Low |
| **P1** | Search bar cleanup | Medium | Low |
| **P1** | Tab bar styling | Medium | Low |
| **P1** | Visit form components — shadows, spacing, touch targets | High — most-used on mobile | Medium (assumes P0-E pattern extraction — StickyProgressBar, FormSection, RadioPair, RemarkField — is complete; without it, effort is High due to 268 className strings across 3,811 lines) |
| **P1** | Admin pages — palette alignment | Medium — used daily by admins | Low |
| **P1** | Login page — accent color alignment | Medium — first impression | Low |
| **P2** | Visits filter form | Low-Medium | Low |
| **P2** | Visit detail layout | Low-Medium | Medium |
| **P2** | Student list action buttons | Medium | Low |
| **P3** | Empty states with icons | Low | Low |
| **P3** | Section header typography | Low | Low |

---

## Constraints

- **No functional changes** — CSS changes, mobile-specific UI improvements, and layout polish are in scope. Changing interaction patterns (combining inputs, hiding buttons behind menus, adding sticky footers that change scroll behavior) is out of scope.
- Tailwind CSS v4 only — no custom CSS unless necessary
- Must remain responsive (mobile-first — PMs use this on phones during school visits, 48px minimum touch targets)
- The existing `UI-Style-Guide.md` should be updated or replaced, not treated as immutable
- New dependency: `lucide-react` for icons (lightweight, tree-shakeable)

---

## Rollout & Review Strategy

- **Ship in per-page PRs** — not one giant PR. Each PR covers one page or one logical group (e.g., all admin pages together). This makes review manageable and allows course correction.
- **Before/after screenshots** in every PR — desktop and mobile viewport. Use browser responsive mode (iPhone SE, iPhone 14, iPad) for mobile screenshots.
- **Get PM feedback after the first 2-3 pages** (Dashboard + School Detail + one visit form) — before completing the rest. This catches design direction issues early.
- **Shared components PR first** — the Button/Card/Input/Badge components ship in their own PR before any per-page work begins.
- **Test on mobile** using browser responsive mode at minimum. If possible, test on an actual phone for visit form components (the most mobile-critical flows).

---

## Decisions

1. **Minimal shared components** — Button, Card, Input, Select, Badge, Modal, StickyProgressBar, FormSection, RadioPair, RemarkField, FormLabel as thin Tailwind wrappers (not a full component library), plus `isPlainObject` utility extraction. This deduplicates styling and prevents drift across 24+ files.
2. **No existing brand guide** — this redesign will inform the creation of the Avanti Fellows style guide, so get it right
3. **Mixed mobile/desktop usage** — must work well on both, no skewing toward one. 48px minimum touch targets.
4. **lucide-react** for icons — lightweight, tree-shakeable, standard Next.js choice
5. **Unify on design tokens** — all components should use the `@theme inline` tokens in globals.css, not a mix of tokens and standard Tailwind colors
