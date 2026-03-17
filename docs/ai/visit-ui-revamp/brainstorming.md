# Visit UI Ledger Revamp — Implementation Plan

## Context

The school visit feature (~15 files) currently uses generic Tailwind gray/blue styling with rounded corners, no shared design system, and no typographic hierarchy. We're revamping it to follow the Ledger UI style guide: emerald green corporate brutalist design with sharp corners, thick accent borders, uppercase headers, monospace numbers, and minimal shadows. This is the first feature area to adopt the style guide; other areas will follow later.

Design doc: `docs/plans/2026-02-26-visit-ui-ledger-revamp-design.md`

### Key pre-work: centralize duplicated helpers

Before restyling, extract the duplicated `visitStatusClass()` / `actionStatusClass()` helpers into a single shared location. Currently duplicated in 3+ files:
- `src/app/visits/[id]/page.tsx` (line ~68, `visitStatusClass`)
- `src/components/visits/ActionPointList.tsx` (line ~108, `actionStatusClass`)
- `src/components/visits/ActionDetailForm.tsx` (line ~380, `actionStatusClass`)
- `src/app/dashboard/page.tsx` (inline at lines ~393-397)
- `src/components/SchoolTabs.tsx` (inline at lines ~100-104)

Create a single `statusBadgeClass(status)` helper in `src/lib/visit-actions.ts` that returns the new theme-mapped classes. All files above should import from it. This prevents updating the same color logic in 5 places.

---

## Step 1: Add CSS variables to globals.css

**File:** `src/app/globals.css`

Add Ledger UI design tokens as CSS custom properties in `:root`. Also register them in the `@theme inline` block so Tailwind generates utility classes for them. Remove the dark mode media query (this is a light-mode-only internal tool).

Concrete actions:

1. **Delete the dark mode media query** (currently lines 18-23 in globals.css):
   ```css
   /* DELETE this entire block */
   @media (prefers-color-scheme: dark) {
     :root {
       --background: #0a0a0a;
       --foreground: #ededed;
     }
   }
   ```

2. **Add CSS custom properties** to `:root`:
   ```css
   :root {
     /* Existing vars stay (--background, --foreground, --font-geist-*) */
     --color-accent: #059669;
     --color-accent-hover: #047857;
     --color-bg: #F0F7F4;
     --color-bg-card: #FFFFFF;
     --color-bg-card-alt: #F5FAF7;
     --color-bg-input: #FFFFFF;
     --color-hover-bg: #E6F2EC;
     --color-border: #D1E7DD;
     --color-border-accent: #059669;
     --color-text-primary: #2A2A2A;
     --color-text-secondary: #6B6560;
     --color-text-muted: #9A948D;
     --color-text-on-accent: #FFFFFF;
     --color-danger: #ef4444;
     --color-danger-bg: rgba(239, 68, 68, 0.08);
     --color-success-bg: rgba(5, 150, 105, 0.08);
     --color-warning-bg: #fef3c7;
     --color-warning-border: #fcd34d;
     --color-warning-text: #92400e;
   }
   ```

3. **Register tokens in `@theme inline`** so Tailwind v4 generates utility classes (e.g., `bg-accent` instead of `bg-[var(--color-accent)]`):
   ```css
   @theme inline {
     /* Keep existing entries */
     --color-background: var(--background);
     --color-foreground: var(--foreground);
     --font-sans: var(--font-geist-sans);
     --font-mono: var(--font-geist-mono);

     /* Ledger UI tokens */
     --color-accent: var(--color-accent);
     --color-accent-hover: var(--color-accent-hover);
     --color-bg: var(--color-bg);
     --color-bg-card: var(--color-bg-card);
     --color-bg-card-alt: var(--color-bg-card-alt);
     --color-bg-input: var(--color-bg-input);
     --color-hover-bg: var(--color-hover-bg);
     --color-border: var(--color-border);
     --color-border-accent: var(--color-border-accent);
     --color-text-primary: var(--color-text-primary);
     --color-text-secondary: var(--color-text-secondary);
     --color-text-muted: var(--color-text-muted);
     --color-text-on-accent: var(--color-text-on-accent);
     --color-danger: var(--color-danger);
     --color-danger-bg: var(--color-danger-bg);
     --color-success-bg: var(--color-success-bg);
     --color-warning-bg: var(--color-warning-bg);
     --color-warning-border: var(--color-warning-border);
     --color-warning-text: var(--color-warning-text);
   }
   ```

   **Why register status colors too:** These are used across ~10 alert/badge instances in visit components. Without registration, every usage requires the verbose `bg-[var(--color-danger-bg)]` syntax instead of clean `bg-danger-bg`. Register them for consistency.

4. **Add global focus ring suppression** (no suppression exists today):
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

   **Note:** `<a>` tags are included because several visit components have `focus:ring-*` classes on links (ActionPointList, CompleteVisitButton). The global suppression handles the CSS layer, but the `focus:ring-*` Tailwind classes must still be **removed from JSX** in each component during Steps 7-12 to avoid generating unused CSS.

---

## Step 2: Create theme.ts

**File (new):** `src/lib/theme.ts`

Export a `theme` const object mirroring the CSS variables. This is used **only** where dynamic inline styles are unavoidable (progress bar width percentage). ~20 lines.

**Scope restriction:** `theme.ts` must NOT be used for color references in JSX — those should always go through CSS variables (`bg-[var(--color-accent)]` or registered Tailwind utilities like `bg-accent`). If both exist, developers will use whichever is convenient, creating two sources of truth. The theme object is only for cases where CSS variables can't work (e.g., `style={{ width: \`${percent}%\` }}`).

---

## Step 3: Restyle visits list page

**File:** `src/app/visits/page.tsx`

Changes:
- Outer `<main>`: `max-w-7xl mx-auto` → full-bleed `min-h-screen bg-[var(--color-bg)]` + progressive padding wrapper
- Page header: bare `h1` → 4px emerald bottom border, uppercase, tracking-tight title
- **Section headers** (`<h2>` "In Progress" / "Completed" at lines ~225, ~292): `text-lg font-semibold text-gray-900` → add `uppercase tracking-wide`, 2px accent bottom border, theme primary color
- Filter form: `bg-white rounded-lg border-gray-200` → `bg-[var(--color-bg-card)] border-[var(--color-border)]` sharp corners
- Filter labels: `text-xs font-medium text-gray-600` → `text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]`
- Filter inputs: `rounded-md border-gray-300` → sharp, 2px border, accent focus
- Apply button: `bg-blue-600 rounded-md` → `bg-[var(--color-accent)]` sharp, uppercase, bold
- Reset link: `bg-gray-100 rounded-md` → secondary style
- Tables: `bg-white shadow rounded-lg` → sharp border, no shadow
- Table headers: `bg-gray-50` → `bg-[var(--color-bg-card-alt)]` + 2px accent bottom border
- Table header text: already uppercase — update `font-medium` → `font-bold`, `text-gray-500` → `text-[var(--color-text-muted)]`
- Data cells: gray → theme text tokens
- Date cells: add `font-mono`
- **Table body dividers**: `divide-y divide-gray-200` on `<tbody>` → replace with per-row `border-b border-[var(--color-border)]` with `40` opacity suffix for faded look
- Row hover: `hover:bg-gray-50` → `hover:bg-[var(--color-hover-bg)]`
- Continue button: `bg-blue-600 rounded-md` → accent sharp, uppercase, bold, `tracking-wide`
- View link: `text-blue-600` → `text-[var(--color-accent)]` bold uppercase
- Empty state: centered uppercase muted text
- Count badges: `font-mono`

---

## Step 3.5: Restyle dashboard visit elements

**File:** `src/app/dashboard/page.tsx`

The dashboard has a "Recent Visits" table (lines ~347-415) and "Start Visit" buttons on school cards (line ~438) that share the same visual vocabulary as the visits list page. If visits pages get the Ledger treatment but the dashboard doesn't, it will look inconsistent.

Changes (visit-related elements only — don't restyle the rest of the dashboard yet):
- Recent Visits section header: `text-lg font-semibold text-gray-900` → add uppercase tracking-wide, theme primary
- "View all" link: `text-sm text-blue-600 hover:text-blue-800` → `text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] font-bold uppercase text-sm`
- Recent Visits table wrapper: `bg-white shadow rounded-lg` → sharp, no shadow, thin border
- Table headers: `bg-gray-50` → `bg-[var(--color-bg-card-alt)]` + 2px accent bottom border
- Table header text: `text-gray-500 font-medium` → `font-bold text-[var(--color-text-muted)]`
- Visit date cells: `text-sm text-gray-500` → add `font-mono`, `text-[var(--color-text-secondary)]`
- Status badges (lines ~393-397): inline `bg-green-100 text-green-800` / `bg-yellow-100 text-yellow-800` → use shared `statusBadgeClass()` from `visit-actions.ts`
- View/Continue links: `text-blue-600 hover:text-blue-800` → accent, font-bold
- "Start Visit" button on school cards (line ~438): `text-white bg-green-600 hover:bg-green-700 rounded-md` → accent sharp, uppercase
- **Add row hover to Recent Visits table:** currently has NO row hover effect (unlike the visits list page which has `hover:bg-gray-50`). Add `hover:bg-[var(--color-hover-bg)]` to `<tr>` elements for consistency with `/visits` list.

**Scope boundary note:** The dashboard `<Pagination>` component (line ~456) and school card grid are NOT restyled in this PR. This creates a visual boundary between Ledger-styled visit elements and generic-styled dashboard elements. This is intentional — the dashboard will get full Ledger treatment in a future PR.

---

## Step 4: Restyle visit detail page

**File:** `src/app/visits/[id]/page.tsx`

Changes:
- Outer `<main>`: `max-w-4xl mx-auto` → full-bleed + progressive padding
- Back link: `text-gray-500 text-sm` → emerald accent, font-semibold, uppercase
- Visit info card: `bg-white shadow rounded-lg` → sharp, no shadow, thin border
- Title: `text-2xl font-bold text-gray-900` → add uppercase tracking-tight
- Visit date: `text-gray-500` → `text-[var(--color-text-secondary)]`
- Timestamps meta: `text-gray-400` → muted, add `font-mono` for time values
- Status badge: keep `rounded-full` but update colors (completed → success-bg/accent-hover, in_progress → warning)
- `visitStatusClass()` helper: update return values
- Progress bar: `bg-gray-200 rounded-full` → `bg-[var(--color-border)]` sharp (no rounding on track). **Add accessibility:** `role="progressbar"`, `aria-valuenow={progressPercent}`, `aria-valuemin={0}`, `aria-valuemax={100}`.
- Progress fill: `bg-green-600 rounded-full` → `bg-[var(--color-accent)]` sharp
- Progress label: update text colors
- Progress numbers: add `font-mono` (both the fraction like "3/5" and the percentage)
- Action count numbers elsewhere on the page: add `font-mono`
- Read-only notice: `bg-gray-50 rounded-md border-gray-200` → sharp, theme colors
- Error/forbidden states: update to theme alert styles. **Add `role="alert"`** for screen reader announcements. There are multiple distinct states:
  - Not-found (line ~126): `bg-red-50 border border-red-200 rounded-lg` → sharp, theme danger
  - Forbidden (line ~142): `bg-yellow-50 border border-yellow-200 rounded-lg` → sharp, theme warning

---

## Step 5: Restyle action detail page

**File:** `src/app/visits/[id]/actions/[actionId]/page.tsx`

Changes:
- Outer `<main>`: full-bleed + progressive padding
- Back link: emerald accent, uppercase
- `notFoundState(title, description)` helper (lines ~73-86): parameterized — used twice with different messages (visit not found vs. action not found). Alert: `rounded-lg border border-red-200 bg-red-50` → sharp, theme danger. Title: `text-base font-semibold text-red-800` → theme danger text. Description: `text-sm text-red-700` → theme danger text. **Add `role="alert"`.**
- `forbiddenState()` helper (lines ~89-101): `rounded-lg border border-yellow-200 bg-yellow-50` → sharp, theme warning. Text: `text-yellow-800` → theme warning text. **Add `role="alert"`.**

---

## Step 6: Restyle new visit page shell

**File:** `src/app/school/[udise]/visit/new/page.tsx`

This is just a thin server component that renders `<NewVisitForm>`. No visual changes needed here — all the work is in Step 10 (NewVisitForm component).

---

## Step 7: Restyle ActionPointList component

**File:** `src/components/visits/ActionPointList.tsx`

Changes:
- Outer container: `bg-white shadow rounded-lg` → sharp, no shadow, thin border
- Section header: `border-b border-gray-200` → 2px accent bottom border
- Title: `text-lg font-semibold text-gray-900` → add uppercase tracking-wide
- Subtitle: `text-gray-500` → muted
- Add button: `bg-blue-600 rounded-md` → accent sharp, uppercase, bold
- Warning/error/GPS alerts: all → sharp, theme colors
- Action cards: update `divide-y divide-gray-200` → `border-b border-[var(--color-border)]`
- Action type name: `text-gray-900` → theme primary
- Action timestamps: add `font-mono`
- `actionStatusClass()`: update to theme status colors
- Status badges: keep rounded-full, update colors
- Start button: `bg-yellow-500 rounded-md` → accent sharp
- Delete button: `border-red-200 bg-red-50 rounded-md` → sharp danger style
- Open/View links: update to accent/secondary theme styles
- Empty state: uppercase muted

---

## Step 8: Restyle ActionTypePickerModal

**File:** `src/components/visits/ActionTypePickerModal.tsx`

Changes:
- Backdrop: `bg-black/40` → `bg-black/50`
- Modal container: `rounded-lg bg-white shadow-xl` → sharp, shadow-xl stays
- Header: `border-b border-gray-200` → 4px accent bottom border
- Title: add uppercase tracking-tight
- Subtitle: theme muted
- Radio options: `rounded-md border-gray-200` → sharp, theme border, theme hover
- Radio accent: `accent-[var(--color-accent)]`
- Footer: `border-t border-gray-200` → theme border
- Cancel button: sharp secondary style
- Add button: `bg-blue-600 rounded-md` → accent sharp, uppercase

---

## Step 9: Restyle ActionDetailForm

**File:** `src/components/visits/ActionDetailForm.tsx`

Changes:
- Header card: `bg-white shadow rounded-lg` → sharp, no shadow, thin border
- Action type title: add uppercase tracking-tight
- Description: theme secondary
- Status badge: theme colors (keep rounded-full)
- `actionStatusClass()`: update returns
- Timestamps: add `font-mono`
- Warning/error/GPS/read-only alerts: all → sharp, theme colors
- Form card: `bg-white shadow rounded-lg` → sharp, no shadow
- Form title: add uppercase tracking-wide
- **Note:** The form uses a dynamic `FieldConfig[]` renderer (lines ~35-46) that generates N field labels + inputs based on action type config. The label/input styles below apply to ALL generated fields, not a fixed set.
- Field labels: `text-sm font-medium text-gray-700` → `text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]`
- Inputs/textareas: `rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500` → sharp, 2px border, accent focus, no shadow/ring
  - **Classes to remove:** `rounded-md`, `shadow-sm`, `focus:border-blue-500`, `focus:ring-1`, `focus:ring-blue-500`
- Save button: `bg-blue-600 rounded-md` → accent sharp, uppercase
- End button: `bg-green-600 rounded-md` → accent sharp, uppercase
- `actionStatusClass()` in this file (line ~380): **remove** after centralizing to shared helper in pre-work step

---

## Step 10: Restyle ClassroomObservationForm

**File:** `src/components/visits/ClassroomObservationForm.tsx`

Changes:
- Sticky score bar: `rounded-md border-blue-200 bg-blue-50` → sharp, `bg-[var(--color-bg-card-alt)] border-2 border-[var(--color-border-accent)]`. **Preserve** `sticky top-2 z-10` positioning.
- Score text: `text-blue-900 font-semibold` → `font-mono font-bold text-[var(--color-accent)]`
- Answered count: `font-mono`
- Parameter sections: `rounded-md border-gray-200` → sharp, theme border
- Parameter title: `text-sm font-semibold text-gray-900` → theme primary, add uppercase
- Parameter description: `text-gray-600` → theme secondary
- Radio inputs: `border-gray-300 text-blue-600 focus:ring-blue-500` → `accent-[var(--color-accent)]`
  - **Classes to remove:** `border-gray-300`, `text-blue-600`, `focus:ring-blue-500`
- Score numbers in options: `text-gray-500` → `font-mono text-[var(--color-text-muted)]`
- "Add remarks" toggle button (line ~161): `text-blue-700` → `text-[var(--color-accent)]`. Note: this controls a `revealedRemarks` state that shows/hides the textarea — preserve the toggle logic, only change colors.
- Remarks textarea: same input style updates as Step 9
- Session summary section (line ~204): `rounded-md border-gray-200` → sharp, theme border, title uppercase
- Session summary textareas (line ~218): same input style updates as Step 9

---

## Step 11: Restyle CompleteVisitButton

**File:** `src/components/visits/CompleteVisitButton.tsx`

Changes:
- Warning alert: `rounded-md bg-yellow-50 border-yellow-200` → sharp, theme warning. **Add `role="alert"`.**
- Error alert: `rounded-md bg-red-50 border-red-200` → sharp, theme danger. **Add `role="alert"`.**
- **Error detail list** (lines ~139-144): renders as `<ul className="list-disc">` with individual error items. Update list marker color to theme danger, text to theme danger text.
- GPS alert: `rounded-md bg-blue-50 border-blue-200` → sharp, theme info style using `bg-[var(--color-bg-card-alt)] border-[var(--color-border)]`
- Cancel link: `text-blue-700` → `text-[var(--color-accent)]`
- Complete button: `rounded-md bg-green-600` → `bg-[var(--color-accent)]` sharp, uppercase, bold, larger padding
- Note: component has a 3-state machine (`"idle" | "acquiring" | "submitting"`) — button text changes per state. Preserve the conditional text, only change styling.

---

## Step 12: Restyle NewVisitForm

**File:** `src/components/visits/NewVisitForm.tsx`

Changes:
- Outer `<main>`: `max-w-2xl mx-auto` → full-bleed + progressive padding
- Card: `bg-white shadow rounded-lg` → sharp, no shadow, thin border
- Title: `text-gray-900` → uppercase tracking-tight, theme primary
- Field labels: `text-sm font-medium text-gray-700` → uppercase tracking-wide, muted
- School code input: `rounded-md border-gray-300 bg-gray-100` → sharp, 2px border, disabled alt bg
- GPS states: all `rounded-md` → sharp + theme colors. There are **4 distinct GPS states** driven by a typed `GpsState` union (lines ~13-17):
  - **Acquiring** (line ~117): `bg-blue-50 border-blue-200` → `bg-[var(--color-bg-card-alt)] border-[var(--color-border)]`. Spinner: `border-blue-600` → `border-[var(--color-accent)]`.
  - **Acquired — good accuracy** (line ~142): green styling → `bg-[var(--color-success-bg)] border-[var(--color-border-accent)]`
  - **Acquired — moderate accuracy** (line ~143): yellow styling → `bg-[var(--color-warning-bg)] border-[var(--color-warning-border)]`
  - **Error — permission denied** (lines ~178-185): red styling + instruction text → sharp, theme danger
  - **Error — other** (lines ~187-194): red styling + "Try again" button → sharp, theme danger
  - **Idle** (line ~203): `rounded-md border-dashed border-gray-300` → sharp, `border-dashed border-[var(--color-border)]`
- GPS accuracy numeric display (line ~166): add `font-mono` to the accuracy value (e.g., "±12m") for consistency with other numeric displays.
- Note: `getAccuracyStatus()` helper (line ~85) drives the good vs. moderate branch — preserve logic, only change colors.
- **API error alert** (line ~212): `mb-6 p-3 bg-red-50 border border-red-200 rounded-md` → sharp, theme danger. Text: `text-sm text-red-800` → theme danger text. **Add `role="alert"`.** (This is separate from the GPS error states — it catches API-level errors from the visit creation request.)
- Start Visit button (line ~223): `rounded-md bg-green-600 focus:ring-*` → accent sharp, uppercase, no ring
  - **Classes to remove:** `rounded-md`, `shadow-sm`, `focus:outline-none`, `focus:ring-2`, `focus:ring-offset-2`, `focus:ring-green-500`
- Cancel/back button (line ~227-233): uses `LoadingLink` component. `LoadingLink` is a pass-through `className` component — update the classes passed TO it from NewVisitForm. The spinner inside LoadingLink uses `border-current` so it auto-matches text color (no change needed inside LoadingLink itself).
  - **Classes to remove:** `rounded-md`, `shadow-sm`, `focus:outline-none`, `focus:ring-2`, `focus:ring-offset-2`, `focus:ring-blue-500`
- Info box at bottom: `rounded-lg bg-blue-50 border-blue-200` → sharp, theme accent-tinted bg
- Info box title/text: `text-blue-900` / `text-blue-800` → theme primary / secondary

---

## Step 13: Restyle SchoolTabs (visit-related parts)

**File:** `src/components/SchoolTabs.tsx`

Changes:
- Tab nav: `border-b border-gray-200` → `border-b-2 border-[var(--color-border)]`
- Active tab: `border-blue-500 text-blue-600` → `border-[var(--color-accent)] text-[var(--color-accent)]`
- Inactive tab: update to theme text colors
- Tab text: add uppercase, font-bold
- `VisitHistorySection`:
  - Empty state: `rounded-lg bg-gray-50 border-gray-200` → sharp, theme
  - Start Visit button: `rounded-md bg-green-600` → accent sharp, uppercase
  - Visit rows: `rounded-lg bg-gray-50` → sharp, `bg-[var(--color-bg-card-alt)]`
  - Status badges: theme colors (keep rounded-full)
  - View/Continue links: `text-blue-600` → accent, font-bold uppercase

---

## Step 14: Restyle VisitsTab

**File:** `src/components/VisitsTab.tsx`

Changes:
- Loading spinner: `border-blue-600` → `border-[var(--color-accent)]`
- Loading text: `text-gray-600` → `text-[var(--color-text-secondary)]`
- Error state: `rounded-lg bg-red-50 border-red-200` → sharp, theme danger

---

## Step 15: Update unit tests for styling changes

### Audit methodology

Full `grep` across all 74 test files for `toHaveClass`, `className`, `toContain`, and `toHaveStyle`. Results below represent an exhaustive scan, not estimates.

### Test risk assessment: why most tests are safe

The visit test suite (44 tests across 10 files) uses **exclusively semantic queries**: `getByRole`, `getByText`, `getByLabelText`, `getByTestId`. Zero files use `toHaveClass`, `className.toContain()`, or `toHaveStyle` on styling properties. This means all functional behavior tests — button enable/disable, conditional rendering, form submissions, GPS state machines, error messages, link hrefs — will pass without changes.

### Tests that WILL break (3 assertions in 1 file):

| File | Line | Assertion | Why it breaks |
|------|------|-----------|---------------|
| `src/components/SchoolTabs.test.tsx` | 54 | `expect(visitsBtn.className).toContain("border-blue-500")` | Active tab border changes from `border-blue-500` to `border-[var(--color-accent)]` or `border-accent` |
| `src/components/SchoolTabs.test.tsx` | 55 | `expect(visitsBtn.className).toContain("text-blue-600")` | Active tab text changes from `text-blue-600` to `text-[var(--color-accent)]` or `text-accent` |
| `src/components/SchoolTabs.test.tsx` | 58 | `expect(studentsBtn.className).toContain("border-transparent")` | Inactive tab border — may still use `border-transparent`, verify after restyling |

**Update strategy for SchoolTabs.test.tsx (line 51-59):**

```typescript
// BEFORE (test "applies active styling to the selected tab button"):
expect(visitsBtn.className).toContain("border-blue-500");
expect(visitsBtn.className).toContain("text-blue-600");
expect(studentsBtn.className).toContain("border-transparent");

// AFTER — update to match new Ledger theme classes:
expect(visitsBtn.className).toContain("border-accent");    // or "border-[var(--color-accent)]"
expect(visitsBtn.className).toContain("text-accent");      // or "text-[var(--color-accent)]"
expect(studentsBtn.className).toContain("border-transparent");  // likely unchanged

// ADDITIONALLY — add assertions for new Ledger typography requirements (Step 13):
expect(visitsBtn.className).toContain("uppercase");
expect(visitsBtn.className).toContain("font-bold");
```

The exact class names depend on whether the implementation uses registered Tailwind utilities (`border-accent`) or CSS variable syntax (`border-[var(--color-accent)]`). Match what the implementation actually emits.

### Tests confirmed safe (semantic queries only, zero class assertions):

These 10 test files cover the components being restyled. Full read-through confirms they use **only** `getByText`/`getByRole`/`getByTestId`/`getByLabelText`/`getByDisplayValue` — no CSS class or style assertions:

| File | Tests | Query style | Notes |
|------|-------|-------------|-------|
| `src/app/visits/page.test.tsx` | 13 | Semantic | Checks headings, table text, link hrefs, filter labels |
| `src/app/visits/[id]/page.test.tsx` | 10 | Semantic | Checks text, roles, testids, permissions |
| `src/app/visits/[id]/actions/[actionId]/page.test.tsx` | 17 | Semantic | Checks form state, error text, save/end flows |
| `src/app/school/[udise]/visit/new/page.test.tsx` | 7 | Semantic | Checks auth redirects, component rendering |
| `src/components/visits/ActionPointList.test.tsx` | 11 | Semantic | Checks button presence by status, action cards by testid |
| `src/components/visits/ActionTypePickerModal.test.tsx` | 4 | Semantic | Checks dialog role, radio labels |
| `src/components/visits/ClassroomObservationForm.test.tsx` | 6 | Semantic + testid | Checks rubric params, score summary text |
| `src/components/visits/CompleteVisitButton.test.tsx` | 6 | Semantic | Checks GPS states, error details text |
| `src/components/visits/NewVisitForm.test.tsx` | 17 | Semantic | Checks GPS flow, button disabled states, accuracy text |
| `src/components/VisitsTab.test.tsx` | 6 | Semantic | Checks data fetching, error text |

**No ActionDetailForm.test.tsx exists** — the `ActionDetailForm` component has no dedicated test file. The action detail *page* test (`src/app/visits/[id]/actions/[actionId]/page.test.tsx`) covers rendering via the page shell but does not test the form component in isolation. This is an existing gap, not introduced by this PR.

### Dashboard test (semantic only, no styling assertions):

`src/app/dashboard/page.test.tsx` has visit-related text assertions that are **all safe**:
- `getByText("Total Visits")` — text, not styling
- `getByText("Recent Visits")` — section heading text
- `getByText("View all")` with `.closest("a").toHaveAttribute("href", "/visits")` — link href
- `getByText("Completed")`, `getByText("In Progress")` — status text (not class names)
- `getByText("View")`, `getByText("Continue")` — action button text

The dashboard restyling (Step 3.5) changes status badge classes from inline `bg-green-100 text-green-800` / `bg-yellow-100 text-yellow-800` to the shared `statusBadgeClass()` helper. Since dashboard tests assert on **text content** ("Completed", "In Progress") not **class names**, they will not break.

### New test: `statusBadgeClass()` in `visit-actions.test.ts`

The pre-work step creates a shared `statusBadgeClass(status)` helper in `src/lib/visit-actions.ts`. The existing test file (`src/lib/visit-actions.test.ts`, 38 lines, 3 tests) covers `ACTION_TYPES`, `isActionType()`, and `getActionTypeLabel()` but has no tests for the new helper.

**Add tests for `statusBadgeClass()`:**

```typescript
// Add to src/lib/visit-actions.test.ts
describe("statusBadgeClass", () => {
  it("returns theme success classes for completed status", () => {
    const cls = statusBadgeClass("completed");
    expect(cls).toContain("bg-success-bg");
    expect(cls).toContain("text-accent-hover");
  });

  it("returns theme warning classes for in_progress status", () => {
    const cls = statusBadgeClass("in_progress");
    expect(cls).toContain("bg-warning-bg");
    expect(cls).toContain("text-warning-text");
  });

  it("returns theme warning classes for pending status", () => {
    const cls = statusBadgeClass("pending");
    expect(cls).toContain("bg-bg-card-alt");
    expect(cls).toContain("text-text-secondary");
  });

  it("returns default muted classes for unknown status", () => {
    const cls = statusBadgeClass("unknown");
    expect(cls).toContain("bg-bg-card-alt");
    expect(cls).toContain("text-text-muted");
  });
});
```

The exact class names above are illustrative — match whatever `statusBadgeClass()` actually returns. The key principle: test all branches (completed, in_progress, pending, unknown fallback).

### New test considerations: `role="alert"` accessibility attributes

Steps 4, 5, 11, and 12 add `role="alert"` to error/warning/forbidden states. No existing tests use `getByRole("alert")`, so adding these attributes **will not break** anything. However, consider adding `getByRole("alert")` assertions in the relevant test files to regression-test the new accessibility attributes:

| Component | Test file | Where to add `getByRole("alert")` |
|-----------|-----------|----------------------------------|
| Visit detail page | `src/app/visits/[id]/page.test.tsx` | Not-found and forbidden states |
| Action detail page | `src/app/visits/[id]/actions/[actionId]/page.test.tsx` | `notFoundState()` and `forbiddenState()` renders |
| CompleteVisitButton | `src/components/visits/CompleteVisitButton.test.tsx` | Warning and error alert renders |
| NewVisitForm | `src/components/visits/NewVisitForm.test.tsx` | API error alert and GPS error renders |

These are **nice-to-have** additions, not required for tests to pass. Add them if the implementation step finishes with time to spare.

### Tests outside visit scope — NOT affected by this PR:

These test files have class assertions on components that are **not being restyled** in this PR:

| File | What it asserts | Why it's safe |
|------|-----------------|---------------|
| `src/components/StudentTable.test.tsx` (line ~1028) | `badge?.className.toContain(expectedClasses[i])` — category badge colors | StudentTable is not restyled in this PR |
| `src/components/StatCard.test.tsx` (lines 19-44) | `className.toContain("text-2xl")`, `"text-lg"`, `"text-3xl"`, `"font-semibold"`, `"text-sm"`, `"text-gray-500"` | StatCard is not restyled in this PR |
| `src/components/LoadingLink.test.tsx` (line 103) | `toHaveClass("custom-class")` — passthrough className | LoadingLink is not being restyled |
| `src/components/curriculum/*.test.tsx` (multiple) | Various class assertions for curriculum POC | Curriculum is not in scope |
| `src/app/layout.test.tsx` (line 42) | `className.toContain("antialiased")` | Root layout is not changed |

These will need updating when their respective components get the Ledger treatment in future PRs.

### Summary: test update checklist

| Action | File | Effort |
|--------|------|--------|
| **Update 3 class assertions** | `src/components/SchoolTabs.test.tsx` | 5 min |
| **Add ~4 tests for `statusBadgeClass()`** | `src/lib/visit-actions.test.ts` | 10 min |
| **Optional: add `role="alert"` assertions** | 4 test files (see table above) | 15 min |
| **Run full suite, verify green** | `npm run test` | 2 min |

**Total mandatory test changes: 1 file, 3 assertions. Total new tests: ~4 (for shared helper).**

---

## Verification

1. **Visual check:** `npm run dev` → navigate through all visit flows:
   - `/dashboard` (recent visits table + start visit buttons)
   - `/visits` (list page)
   - `/visits/[id]` (detail page)
   - `/visits/[id]/actions/[actionId]` (action detail)
   - `/school/[udise]/visit/new` (new visit)
   - School page → Visits tab
2. **Unit tests:** `npm run test` — all tests must pass
3. **Build check:** `npm run build` — must compile without errors
4. **Responsive check:** resize browser through all breakpoints (mobile → desktop)
5. **Consistency check:** compare dashboard visit table styling with `/visits` list page — they should look identical

---

## Files Modified (17 total)

| # | File | Type | Step |
|---|---|---|---|
| 1 | `src/app/globals.css` | Modified (add CSS vars, delete dark mode, add focus suppression) | 1 |
| 2 | `src/lib/theme.ts` | New file (dynamic inline styles only) | 2 |
| 3 | `src/lib/visit-actions.ts` | Modified (add shared `statusBadgeClass()` helper) | Pre-work |
| 4 | `src/app/visits/page.tsx` | Modified | 3 |
| 5 | `src/app/dashboard/page.tsx` | Modified (visit-related elements only) | 3.5 |
| 6 | `src/app/visits/[id]/page.tsx` | Modified | 4 |
| 7 | `src/app/visits/[id]/actions/[actionId]/page.tsx` | Modified | 5 |
| 8 | `src/components/visits/ActionPointList.tsx` | Modified | 7 |
| 9 | `src/components/visits/ActionTypePickerModal.tsx` | Modified | 8 |
| 10 | `src/components/visits/ActionDetailForm.tsx` | Modified | 9 |
| 11 | `src/components/visits/ClassroomObservationForm.tsx` | Modified | 10 |
| 12 | `src/components/visits/CompleteVisitButton.tsx` | Modified | 11 |
| 13 | `src/components/visits/NewVisitForm.tsx` | Modified | 12 |
| 14 | `src/components/SchoolTabs.tsx` | Modified | 13 |
| 15 | `src/components/VisitsTab.tsx` | Modified | 14 |
| 16 | `src/components/SchoolTabs.test.tsx` | Modified (3 class name assertions) | 15 |
| 17 | `src/lib/visit-actions.test.ts` | Modified (add ~4 tests for `statusBadgeClass()`) | 15 |

Step 6 (`src/app/school/[udise]/visit/new/page.tsx`) needs no changes — it's a thin server shell.

`src/components/LoadingLink.tsx` does NOT need changes — it's a pass-through `className` component. The classes passed to it from `NewVisitForm.tsx` are updated in Step 12.

`src/app/visits/[id]/principal/page.tsx` exists as a legacy redirect (`redirect("/visits/${id}")`) — no styling, no changes needed.

---

## Implementation checklist: classes to remove

When restyling each component, it's easy to **add** new theme classes but forget to **remove** old conflicting ones. This is a cross-cutting checklist of class patterns that must be removed wherever they appear in the 16 files:

### Rounded corners (remove from all Ledger data elements)
- `rounded-lg` — card/panel containers
- `rounded-md` — inputs, buttons, alerts, GPS states
- `rounded-full` on progress bar track/fill (keep `rounded-full` ONLY on status badges)

### Shadows (remove from all Ledger data elements)
- `shadow` — card/panel containers
- `shadow-sm` — inputs, buttons
- `shadow-xl` stays on modal container (ActionTypePickerModal) per style guide

### Focus rings (remove from JSX — global CSS handles suppression)
- `focus:ring-1`, `focus:ring-2`
- `focus:ring-offset-2`
- `focus:ring-blue-500`, `focus:ring-green-500`
- `focus:border-blue-500`
- `focus:outline-none` can stay (harmless, defensive)

### Old color classes (replace with theme tokens)
- `bg-blue-600`, `hover:bg-blue-700` → `bg-accent`, `hover:bg-accent-hover`
- `bg-green-600`, `hover:bg-green-700` → `bg-accent`, `hover:bg-accent-hover`
- `bg-yellow-500` → `bg-accent`
- `text-blue-600`, `hover:text-blue-800` → `text-accent`, `hover:text-accent-hover`
- `text-gray-900` → `text-text-primary`
- `text-gray-500`, `text-gray-600` → `text-text-secondary`
- `text-gray-400`, `text-gray-700` → `text-text-muted`
- `bg-gray-50` → `bg-bg-card-alt`
- `bg-gray-100` → `bg-bg-card-alt`
- `border-gray-200`, `border-gray-300` → `border-border`
- `hover:bg-gray-50` → `hover:bg-hover-bg`
- `divide-y divide-gray-200` → per-row `border-b border-border`

### Alert color classes (replace with theme status tokens)
- `bg-red-50` → `bg-danger-bg`
- `border-red-200` → `border-danger/20` (or explicit opacity)
- `text-red-700`, `text-red-800` → `text-danger`
- `bg-yellow-50` → `bg-warning-bg`
- `border-yellow-200` → `border-warning-border`
- `text-yellow-700`, `text-yellow-800` → `text-warning-text`
- `bg-blue-50` (info alerts) → `bg-bg-card-alt`
- `border-blue-200` (info alerts) → `border-border`
