# UI Consistency & Responsiveness Fix Plan

## Context
The app has grown organically — enrollment, curriculum, visits, admin, performance — each adding slightly different styling patterns. The result is an inconsistent UI: different input heights, button sizes, header patterns, shadow hierarchies, spinner styles, tab colors, and poor mobile behavior. This plan normalizes everything to a single consistent design system.

---

## Part 1: Bugs to Fix

### 1.1 Duplicate student count in SchoolCard
**File:** `src/components/SchoolCard.tsx:47-56`
Two identical conditional blocks render student count twice:
```tsx
// Lines 47-50: renders "X students" in text-gray-600
{showStudentCount && school.student_count !== undefined && (
  <p className="mt-2 text-sm text-gray-600">{school.student_count} students</p>
)}
// Lines 52-56: renders SAME "X students" in text-blue-600 font-medium
{showStudentCount && school.student_count !== undefined && (
  <p className="mt-2 text-sm font-medium text-blue-600">{school.student_count} students</p>
)}
```
**Fix:** Delete lines 47-50 (the gray duplicate). Keep the blue version.

### 1.2 Font never renders
**File:** `src/app/globals.css:26`
```css
body { font-family: Arial, Helvetica, sans-serif; }
```
This overrides the Geist font loaded in `layout.tsx`. The Tailwind theme correctly maps `--font-sans` to Geist, but the body CSS override wins.
**Fix:** Remove the explicit `font-family` line from globals.css.
**Add safety fallback:** Ensure the app still explicitly opts into the Geist variable font by either:
- Adding `font-sans` to the `<body>` className in `src/app/layout.tsx`, OR
- Setting `body { font-family: var(--font-sans); }` in `src/app/globals.css`.
Verify via browser devtools that `body` computed `font-family` reflects Geist (not Arial/system).

### 1.3 Dark mode CSS variables conflict
**File:** `src/app/globals.css:15-20`
```css
@media (prefers-color-scheme: dark) {
  :root { --background: #0a0a0a; --foreground: #ededed; }
}
```
Every component uses hardcoded light-mode Tailwind classes (`bg-gray-50`, `text-gray-900`). On dark-mode OS settings, the body gets `#0a0a0a` background but everything else stays light — creating a broken flash.
**Fix:** Remove the dark-mode media query entirely. This is a light-only app.

---

## Part 2: Design Token System

### 2.1 Create `src/lib/ui.ts`
A single file with reusable Tailwind class-string constants. Not a component library — just strings to import, eliminating copy-paste drift.

```ts
// ── Inputs ──
export const input = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500";
export const inputDisabled = input; // prefer `disabled:` variants over `!important`
export const inputSearch = `${input} pl-10`; // for search inputs with left icon

// ── Buttons ──
export const btnBase = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = `${btnBase} bg-blue-600 text-white hover:bg-blue-700`;
export const btnSecondary = `${btnBase} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
export const btnDanger = `${btnBase} bg-red-600 text-white hover:bg-red-700`;
export const btnSuccess = `${btnBase} bg-green-600 text-white hover:bg-green-700`;
export const btnGhost = "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors";

// Size variants
export const btnSm = "!px-3 !py-1.5 !text-xs"; // composable: className={`${btnPrimary} ${btnSm}`}
export const btnLg = "!px-5 !py-3";
export const btnFull = "!w-full";

// ── Cards ──
export const card = "bg-white rounded-lg shadow-sm";
export const cardHover = `${card} hover:shadow-md transition-shadow`;
export const cardPadded = `${card} p-6`;

// ── Badges ──
export const badge = "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium";

// ── Loading ──
export const spinner = "animate-spin rounded-full border-2 border-gray-300 border-t-blue-600";
export const spinnerSm = `${spinner} h-4 w-4`;
export const spinnerMd = `${spinner} h-6 w-6`;
export const spinnerLg = `${spinner} h-8 w-8`;

// ── Tabs ──
export const tabBase = "whitespace-nowrap py-3 px-1 border-b-2 text-sm font-medium transition-colors";
export const tabActive = `${tabBase} border-blue-600 text-blue-600`;
export const tabInactive = `${tabBase} border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300`;

// ── Labels ──
export const label = "block text-sm font-medium text-gray-700";

// ── Alerts ──
export const alertError = "rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800";
export const alertWarning = "rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800";
export const alertSuccess = "rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800";
export const alertInfo = "rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800";

// ── Modal ──
export const modalBackdrop = "fixed inset-0 z-40 bg-black/30";
export const modalContainer = "fixed inset-0 z-50 overflow-y-auto";
export const modalContent = "relative w-full rounded-lg bg-white p-6 shadow-xl";

// ── Page shell ──
export const pageShell = "min-h-screen bg-gray-50";
export const pageMain = "mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8";
export const pageMainNarrow = "mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8";
```

---

## Part 3: Consistent Page Shell & Header

### 3.1 Extend `PageHeader` component
**File:** `src/components/PageHeader.tsx`

Currently only used by the school page. Dashboard, admin pages, visits pages all build their own inline headers. We extend `PageHeader` to handle all cases:

**Add props:**
- `nav?: { label: string; href: string; active?: boolean }[]` — for PM navigation (Schools | Visits)
- `badge?: string` — for "Admin access" / "Region access" subtitle replacement

**Mobile improvements:**
- Stack `title + nav` and `actions + email` on two rows on mobile
- Hide full email on mobile (show just a user icon or truncated version)
- Make nav links scrollable horizontally if needed

### 3.2 Apply PageHeader to all pages

**Pages that currently build inline headers (will use PageHeader):**
- `src/app/dashboard/page.tsx` — Inline header with nav
- `src/app/admin/page.tsx` — Inline header
- `src/app/admin/users/page.tsx` — Inline header with back arrow
- `src/app/admin/schools/page.tsx` — Inline header with back arrow
- `src/app/admin/batches/page.tsx` — Inline header

**Pages missing headers entirely (will add PageHeader):**
- `src/app/visits/page.tsx` — No header, no back nav
- `src/app/visits/[id]/page.tsx` — Text back link only

**Pages already using PageHeader (just verify):**
- `src/app/school/[udise]/page.tsx` — Already uses it

### 3.3 Apply page shell to all pages

Every page must wrap in:
```tsx
<div className={pageShell}>
  <PageHeader ... />
  <main className={pageMain}>
    ...
  </main>
</div>
```

**Currently missing `min-h-screen bg-gray-50`:**
- `src/app/visits/page.tsx`
- `src/app/visits/[id]/page.tsx`
- `src/app/school/[udise]/visit/new/page.tsx`

---

## Part 4: File-by-File Token Application

### 4.1 `src/app/globals.css`
- Remove `font-family: Arial, Helvetica, sans-serif;` from body
- Remove dark-mode `@media` block
- If Geist still doesn’t apply after removing Arial, add the safety fallback (see 1.2)

### 4.2 `src/components/SchoolCard.tsx`
- Delete duplicate student count (lines 47-50)
- Replace card container classes with `cardHover` + `p-6`

### 4.3 `src/components/SchoolSearch.tsx`
- Replace input from `rounded-lg ... py-3 pl-10 pr-4 text-sm` to `inputSearch` token (standardize to `rounded-md py-2`)
- Replace spinner with `spinnerSm` token

### 4.4 `src/components/StudentSearch.tsx`
- Replace input from custom classes to `inputSearch` token
- Replace spinner from `border-2 border-gray-300 border-t-blue-600` to `spinnerSm` token

### 4.5 `src/components/StudentTable.tsx`
- **Tabs:** Replace inline active/inactive classes with `tabActive`/`tabInactive` tokens
- **Buttons:** Replace Edit button `bg-blue-600 ... px-4 py-2 ... rounded-md` with `btnPrimary`
- **Buttons:** Replace Dropout button with `btnDanger`
- **Select:** Replace grade filter select with `input` token
- **Expanded grid:** Change `grid-cols-3` to `grid-cols-1 sm:grid-cols-3` for mobile

### 4.6 `src/components/EditStudentModal.tsx`
- Already defines `inputClassName` and `labelClassName` locally — replace with imports from `ui.ts`
- Replace modal backdrop `bg-black bg-opacity-30` with `modalBackdrop` token
- Replace cancel/submit buttons with `btnSecondary`/`btnPrimary` tokens

### 4.7 `src/components/SchoolTabs.tsx`
- Replace tab active: `border-blue-500 text-blue-600` → `tabActive` (standardize to `blue-600`)
- Replace tab inactive class with `tabInactive`

### 4.8 `src/components/curriculum/CurriculumTab.tsx`
- Replace tab active: `border-blue-500 text-blue-600` → `tabActive` (standardize to `blue-600`)
- Replace tab inactive with `tabInactive`
- Replace "+ Log Session" button with `btnPrimary` token
- Replace spinner `border-2 border-gray-300 border-t-blue-600` with `spinnerLg` token
- Replace selects with `input` token

### 4.9 `src/components/curriculum/LogSessionModal.tsx`
- Replace modal backdrop/container with modal tokens
- Replace Cancel/Save buttons with `btnSecondary`/`btnPrimary`
- Replace input styles with `input` token

### 4.10 `src/components/curriculum/ChapterAccordion.tsx`
- Replace card shadow `shadow` with `shadow-sm` (match `card` token)

### 4.11 `src/components/curriculum/SessionHistory.tsx`
- Replace card shadow `shadow` with `shadow-sm`

### 4.12 `src/components/curriculum/ProgressSummary.tsx`
- Replace card shadow `shadow` with `shadow-sm`

### 4.13 `src/components/PerformanceTab.tsx`
- Replace spinner from `border-b-2 border-blue-600` (wrong style — only shows bottom border) with `spinnerLg` token

### 4.14 `src/components/VisitsTab.tsx`
- Replace spinner with `spinnerLg` token

### 4.15 `src/components/QuizAnalyticsSection.tsx`
- Replace card `shadow` with `shadow-sm`
- Replace spinner with `spinnerLg` token
- Replace select with `input` token

### 4.16 `src/components/StatCard.tsx`
- No changes needed (already clean and reusable)

### 4.17 `src/components/Pagination.tsx`
- No token changes needed (already has distinct styling for pagination elements)
- Add the `card` base shadow-sm to outer container (currently uses `shadow`)

### 4.18 `src/components/visits/NewVisitForm.tsx`
- Replace "Start Visit" button with `btnSuccess` + `btnFull` tokens
- Replace "Cancel and go back" with `btnSecondary`
- Replace disabled input with `inputDisabled`
- Button layout: `flex flex-col sm:flex-row gap-3` for mobile stacking
- Add page shell wrapper in parent page

### 4.19 `src/components/visits/EndVisitButton.tsx`
- Replace button with `btnDanger` + `btnFull` tokens
- Replace spinner `border-2 border-blue-600 border-t-transparent` with `spinnerSm` token

### 4.20 `src/components/LoadingLink.tsx`
- Replace spinner with `spinnerSm` token (currently uses `border-current` which is fine but inconsistent)

### 4.21 `src/app/page.tsx` (Login)
- Replace "Sign in with Google" button with `btnSecondary` + `btnLg` + `btnFull` composition
- Replace "Enter School Passcode" button with `btnSecondary` + `btnLg` + `btnFull`
- Replace "Continue" button with `btnPrimary` + `btnLg` + `btnFull`
- Replace passcode input with `input` token + additional center/tracking styles
- Login card: `shadow-lg` → `shadow-sm` (match system)

### 4.22 `src/app/dashboard/page.tsx`
- Replace inline header with `PageHeader` component
- Replace stat cards with `cardPadded` token
- Replace "Start Visit" button with `btnSuccess` + `btnSm`
- Replace inline table with responsive version (card view on mobile)
- Alert boxes: use `alertWarning` token

### 4.23 `src/app/visits/page.tsx`
- Add page shell (`pageShell` + `PageHeader` + `pageMain`)
- Replace "Continue" button in table with `btnPrimary` + `btnSm`
- Add mobile card view for tables

### 4.24 `src/app/visits/[id]/page.tsx`
- Add page shell (`pageShell` + `PageHeader` + `pageMainNarrow`)
- Remove loose `← Back to Dashboard` text link (PageHeader handles this)
- Replace card `shadow` with `shadow-sm` token
- Replace alert boxes with alert tokens

### 4.25 `src/app/school/[udise]/visit/new/page.tsx`
- Add page shell wrapper
- Page currently just renders `<NewVisitForm>` — wrap in shell

### 4.26 `src/app/admin/page.tsx`
- Replace inline header with `PageHeader`
- Replace cards with `cardHover` + `p-6` tokens

### 4.27 `src/app/admin/users/page.tsx`
- Replace inline header with `PageHeader` (backHref="/admin")
- "Add User" button already fine

### 4.28 `src/app/admin/users/AddUserModal.tsx`
- Already defines `inputClassName`/`labelClassName` — replace with imports from `ui.ts`
- Replace modal structure with modal tokens
- Replace buttons with `btnSecondary`/`btnPrimary`

### 4.29 `src/app/admin/users/UserList.tsx`
- "Add User" button → `btnPrimary`
- Table container uses `ring-1 ring-black ring-opacity-5` — keep as is (admin tables have slightly different treatment, it works)

### 4.30 `src/app/admin/schools/page.tsx`
- Replace inline header with `PageHeader` (backHref="/admin")

### 4.31 `src/app/admin/schools/SchoolList.tsx`
- Replace stat cards with `card` + `p-4` tokens
- Replace search input with `input` token
- Replace select with `input` token
- Replace modal backdrop/container with modal tokens
- Replace buttons with `btnSecondary`/`btnPrimary`

### 4.32 `src/app/admin/batches/page.tsx`
- Replace inline header with `PageHeader` (backHref="/admin")

### 4.33 `src/app/admin/batches/BatchList.tsx`
- Replace select with `input` token
- Replace buttons — no token changes for inline table Save/Cancel (text-link style is fine)

---

## Part 5: Mobile Responsiveness Fixes

### 5.1 PageHeader mobile layout
```
Desktop: [BackArrow] [Title + Subtitle] [Nav Links]     [Actions] [Email] [Sign out]
Mobile:  [BackArrow] [Title + Subtitle]                  [Sign out icon]
         [Nav Links (scrollable)]
```
- Title truncates on mobile
- Email hidden below `sm:`, show just sign-out icon
- Nav links go on second row if present
- Admin link inline with nav

### 5.2 Dashboard — Visit table mobile view
Replace `<table>` with a responsive pattern:
- `hidden sm:block` on `<table>`
- `sm:hidden` on a card-based list view
- Each card shows: School name, Date, Status badge, Continue/View link

### 5.3 Visits list page — same treatment
Both "In Progress" and "Completed" tables get the same responsive card fallback.

### 5.4 Student card expanded grid
**File:** `src/components/StudentTable.tsx:176`
```diff
-<div className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
+<div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
```

### 5.5 NewVisitForm actions
**File:** `src/components/visits/NewVisitForm.tsx:218`
```diff
-<div className="flex gap-3">
+<div className="flex flex-col sm:flex-row gap-3">
```

### 5.6 SchoolTabs (VisitHistorySection) table items
Already using flex layout with `p-3 bg-gray-50 rounded-lg` — works on mobile. No change needed.

### 5.7 Admin tables
Admin pages are desktop-only workflow — users are admins on laptops. Add `overflow-x-auto` wrapper (already present on most). No card fallback needed.

### 5.8 Curriculum ProgressSummary
**File:** `src/components/curriculum/ProgressSummary.tsx:19`
```diff
-<div className="grid grid-cols-3 gap-4">
+<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
```

### 5.9 Quiz analytics stat grid
**File:** `src/components/QuizAnalyticsSection.tsx:148`
Already has `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`. Fine.

### 5.10 Login page
Already centered with `max-w-md` — works well on mobile. No changes needed.

---

## Part 6: Summary of All Files Touched

| # | File | Changes |
|---|------|---------|
| 1 | `src/lib/ui.ts` | **NEW** — All design tokens |
| 2 | `src/app/globals.css` | Remove Arial override + dark mode |
| 3 | `src/components/PageHeader.tsx` | Add nav/badge props, mobile layout |
| 4 | `src/components/SchoolCard.tsx` | Fix duplicate, apply card token |
| 5 | `src/components/SchoolSearch.tsx` | Normalize input + spinner |
| 6 | `src/components/StudentSearch.tsx` | Normalize input + spinner |
| 7 | `src/components/StudentTable.tsx` | Tokens for btns/tabs, mobile grid |
| 8 | `src/components/EditStudentModal.tsx` | Import tokens, modal tokens |
| 9 | `src/components/SchoolTabs.tsx` | Tab color normalization |
| 10 | `src/components/curriculum/CurriculumTab.tsx` | Tabs, button, spinner, select tokens |
| 11 | `src/components/curriculum/LogSessionModal.tsx` | Modal + button tokens |
| 12 | `src/components/curriculum/ChapterAccordion.tsx` | Shadow normalization |
| 13 | `src/components/curriculum/SessionHistory.tsx` | Shadow normalization |
| 14 | `src/components/curriculum/ProgressSummary.tsx` | Shadow + mobile grid |
| 15 | `src/components/PerformanceTab.tsx` | Fix spinner (wrong style) |
| 16 | `src/components/VisitsTab.tsx` | Spinner token |
| 17 | `src/components/QuizAnalyticsSection.tsx` | Shadow, spinner, select tokens |
| 18 | `src/components/Pagination.tsx` | Shadow normalization |
| 19 | `src/components/visits/NewVisitForm.tsx` | Btns, input, mobile layout |
| 20 | `src/components/visits/EndVisitButton.tsx` | Btn + spinner tokens |
| 21 | `src/components/LoadingLink.tsx` | Spinner token |
| 22 | `src/app/page.tsx` | Login btns + input tokens |
| 23 | `src/app/dashboard/page.tsx` | PageHeader, tokens, mobile table |
| 24 | `src/app/visits/page.tsx` | Page shell, tokens, mobile table |
| 25 | `src/app/visits/[id]/page.tsx` | Page shell, tokens |
| 26 | `src/app/school/[udise]/page.tsx` | Verify (already uses PageHeader) |
| 27 | `src/app/school/[udise]/visit/new/page.tsx` | Page shell wrapper |
| 28 | `src/app/admin/page.tsx` | PageHeader, card tokens |
| 29 | `src/app/admin/users/page.tsx` | PageHeader |
| 30 | `src/app/admin/users/UserList.tsx` | Button token |
| 31 | `src/app/admin/users/AddUserModal.tsx` | Import tokens from ui.ts |
| 32 | `src/app/admin/schools/page.tsx` | PageHeader |
| 33 | `src/app/admin/schools/SchoolList.tsx` | Card, input, modal, btn tokens |
| 34 | `src/app/admin/batches/page.tsx` | PageHeader |
| 35 | `src/app/admin/batches/BatchList.tsx` | Select token |

---

## Execution Order

1. **Create `src/lib/ui.ts`** — All tokens in one shot
2. **Fix `globals.css`** — Font + dark mode bugs
3. **Extend `PageHeader`** — Nav + mobile support
4. **Fix `SchoolCard`** — Duplicate bug
5. **Apply tokens to shared components** (4.3 → 4.20) — Bottom-up, components before pages
6. **Apply tokens to pages** (4.21 → 4.33) — Top-down, login → dashboard → school → visits → admin
7. **Mobile responsiveness fixes** (Part 5) — Can be done inline with steps 5-6

---

## Verification

1. `npm run lint` — No lint errors
2. `npm run build` — No type/build errors
2. Desktop check at 1440px: Login, Dashboard, School page (all tabs), Visit detail, Visits list, New Visit, Admin pages
3. Mobile check at 375px: Same pages — verify no overflow, all buttons tappable, tables replaced with cards
4. Functional check: Edit student modal, Dropout modal, Search dropdowns, Tab switching, Start/End visit GPS flow
5. Verify Geist font renders (inspect body computed style)
6. Docs hygiene: if updating `/docs/ai/project-context.md`, ensure its “Last updated” date is accurate.
