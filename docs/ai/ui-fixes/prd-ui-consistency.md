# PRD: UI Consistency & Responsiveness

## Introduction

The app has grown organically across enrollment, curriculum, visits, admin, and performance features — each introducing slightly different styling patterns. The result is inconsistent input heights, button sizes, header patterns, shadow hierarchies, spinner styles, tab colors, and poor mobile behavior. This PRD establishes a design token system and normalizes every component and page to use it, while fixing mobile responsiveness for field PMs using phones.

## Goals

- Create a single source of truth for UI styles (`src/lib/ui.ts`) to eliminate copy-paste drift
- Fix known bugs: duplicate student count, Geist font not rendering, dark mode flash
- Normalize all inputs, buttons, cards, spinners, tabs, modals, and alerts to use shared tokens
- Extend `PageHeader` to cover all page header patterns (nav links, badges, mobile layout)
- Make all PM-facing pages (dashboard, visits, school) usable on 375px mobile screens

## User Stories

### US-001: Create design token file `src/lib/ui.ts`
**Description:** As a developer, I want a single file of reusable Tailwind class-string constants so that every component imports consistent styles instead of duplicating them.

**Acceptance Criteria:**
- [ ] Create `src/lib/ui.ts` with all tokens as specified in the brainstorming doc (Part 2.1)
- [ ] Tokens cover: `input`, `inputSearch`, `btnBase`, `btnPrimary`, `btnSecondary`, `btnDanger`, `btnSuccess`, `btnGhost`, `btnSm`, `btnLg`, `btnFull`, `card`, `cardHover`, `cardPadded`, `badge`, `spinner`/`spinnerSm`/`spinnerMd`/`spinnerLg`, `tabBase`/`tabActive`/`tabInactive`, `label`, `alertError`/`alertWarning`/`alertSuccess`/`alertInfo`, `modalBackdrop`/`modalContainer`/`modalContent`, `pageShell`/`pageMain`/`pageMainNarrow`
- [ ] File exports only string constants — no React components
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-002: Fix globals.css — font override and dark mode
**Description:** As a user, I want to see the Geist font the app loads (not Arial) and not experience a dark-mode flash on dark OS settings.

**Acceptance Criteria:**
- [ ] Remove `font-family: Arial, Helvetica, sans-serif;` from `src/app/globals.css` body rule
- [ ] Remove the `@media (prefers-color-scheme: dark)` block entirely from `src/app/globals.css`
- [ ] Ensure body still gets Geist font — either add `font-sans` to `<body>` className in `src/app/layout.tsx` or set `body { font-family: var(--font-sans); }` in globals.css
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-003: Fix duplicate student count in SchoolCard
**Description:** As a user, I want to see the student count displayed once per school card, not twice.

**Acceptance Criteria:**
- [ ] In `src/components/SchoolCard.tsx`, remove the first (gray) duplicate student count block (lines 47-50 or equivalent)
- [ ] Keep only the blue `font-medium text-blue-600` version
- [ ] Replace card container classes with `cardHover` + `p-6` tokens from `ui.ts`
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-004: Extend PageHeader with nav and mobile support
**Description:** As a developer, I want `PageHeader` to handle navigation links and mobile layouts so every page can use it instead of building custom inline headers.

**Acceptance Criteria:**
- [ ] Add optional `nav` prop: `{ label: string; href: string; active?: boolean }[]` — renders horizontal nav links
- [ ] Add optional `badge` prop: `string` — renders a small badge/subtitle (e.g., "Admin access")
- [ ] Desktop layout: `[BackArrow] [Title + Subtitle] [Nav Links] ... [Actions] [Email] [Sign out]`
- [ ] Mobile layout: Title truncates, email hidden below `sm:` (show just sign-out icon or text), nav links go to second row if present and scroll horizontally
- [ ] Existing pages that already use `PageHeader` (school page) continue working with no changes
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-005: Normalize SchoolSearch input and spinner
**Description:** As a user, I want the school search input to match the app's standard input style.

**Acceptance Criteria:**
- [ ] In `src/components/SchoolSearch.tsx`, replace the search input classes with `inputSearch` token from `ui.ts`
- [ ] Replace the loading spinner classes with `spinnerSm` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-006: Normalize StudentSearch input and spinner
**Description:** As a user, I want the student search input to match the app's standard input style.

**Acceptance Criteria:**
- [ ] In `src/components/StudentSearch.tsx`, replace the search input classes with `inputSearch` token from `ui.ts`
- [ ] Replace the loading spinner classes with `spinnerSm` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-007: Normalize StudentTable tabs, buttons, and mobile grid
**Description:** As a user, I want consistent tab styling, button styles, and a readable layout on mobile in the student table.

**Acceptance Criteria:**
- [ ] In `src/components/StudentTable.tsx`, replace inline tab active/inactive classes with `tabActive`/`tabInactive` tokens
- [ ] Replace Edit button classes with `btnPrimary` token
- [ ] Replace Dropout button classes with `btnDanger` token
- [ ] Replace grade filter select with `input` token
- [ ] Change expanded student detail grid from `grid-cols-3` to `grid-cols-1 sm:grid-cols-3`
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-008: Normalize EditStudentModal tokens
**Description:** As a developer, I want the edit student modal to use shared tokens instead of locally defined class strings.

**Acceptance Criteria:**
- [ ] In `src/components/EditStudentModal.tsx`, replace local `inputClassName` and `labelClassName` with imports of `input` and `label` from `ui.ts`
- [ ] Replace modal backdrop classes with `modalBackdrop` token
- [ ] Replace Cancel button with `btnSecondary` token
- [ ] Replace Submit button with `btnPrimary` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-009: Normalize SchoolTabs tab colors
**Description:** As a user, I want consistent tab colors across the school page tabs.

**Acceptance Criteria:**
- [ ] In `src/components/SchoolTabs.tsx`, replace tab active classes (e.g., `border-blue-500 text-blue-600`) with `tabActive` token (standardizes on `blue-600`)
- [ ] Replace tab inactive classes with `tabInactive` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-010: Normalize CurriculumTab tabs, button, spinner, and selects
**Description:** As a user, I want consistent styling in the curriculum tab for tabs, the log session button, loading spinner, and select dropdowns.

**Acceptance Criteria:**
- [ ] In `src/components/curriculum/CurriculumTab.tsx`, replace tab active/inactive classes with `tabActive`/`tabInactive` tokens
- [ ] Replace "+ Log Session" button with `btnPrimary` token
- [ ] Replace spinner classes with `spinnerLg` token
- [ ] Replace select elements with `input` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-011: Normalize LogSessionModal tokens
**Description:** As a developer, I want the log session modal to use shared tokens.

**Acceptance Criteria:**
- [ ] In `src/components/curriculum/LogSessionModal.tsx`, replace modal backdrop/container with `modalBackdrop`/`modalContainer`/`modalContent` tokens
- [ ] Replace Cancel button with `btnSecondary` token
- [ ] Replace Save button with `btnPrimary` token
- [ ] Replace input styles with `input` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-012: Normalize curriculum card shadows
**Description:** As a user, I want consistent card shadow depth across curriculum components.

**Acceptance Criteria:**
- [ ] In `src/components/curriculum/ChapterAccordion.tsx`, replace `shadow` with `shadow-sm` (matching `card` token)
- [ ] In `src/components/curriculum/SessionHistory.tsx`, replace `shadow` with `shadow-sm`
- [ ] In `src/components/curriculum/ProgressSummary.tsx`, replace `shadow` with `shadow-sm`
- [ ] In `ProgressSummary.tsx`, change `grid-cols-3` to `grid-cols-1 sm:grid-cols-3` for mobile
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-013: Fix PerformanceTab spinner
**Description:** As a user, I want to see a proper circular spinner in the performance tab instead of a broken border-only style.

**Acceptance Criteria:**
- [ ] In `src/components/PerformanceTab.tsx`, replace spinner from `border-b-2 border-blue-600` (wrong — only bottom border) with `spinnerLg` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-014: Normalize VisitsTab spinner
**Description:** As a user, I want a consistent loading spinner in the visits tab.

**Acceptance Criteria:**
- [ ] In `src/components/VisitsTab.tsx`, replace spinner classes with `spinnerLg` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-015: Normalize QuizAnalyticsSection shadow, spinner, and select
**Description:** As a user, I want consistent styling in the quiz analytics section.

**Acceptance Criteria:**
- [ ] In `src/components/QuizAnalyticsSection.tsx`, replace card `shadow` with `shadow-sm`
- [ ] Replace spinner with `spinnerLg` token
- [ ] Replace select with `input` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-016: Normalize Pagination shadow
**Description:** As a user, I want consistent shadow on the pagination component.

**Acceptance Criteria:**
- [ ] In `src/components/Pagination.tsx`, replace outer container `shadow` with `shadow-sm` (matching `card` token)
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-017: Normalize NewVisitForm buttons and mobile layout
**Description:** As a PM on mobile, I want the visit form buttons to stack vertically on small screens and use consistent button styles.

**Acceptance Criteria:**
- [ ] In `src/components/visits/NewVisitForm.tsx`, replace "Start Visit" button with `btnSuccess` + `btnFull` tokens
- [ ] Replace "Cancel and go back" with `btnSecondary` token
- [ ] Replace disabled input with `input` token (disabled variants handled by the token's `disabled:` classes)
- [ ] Change button container from `flex gap-3` to `flex flex-col sm:flex-row gap-3`
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-018: Normalize EndVisitButton tokens
**Description:** As a PM, I want the end visit button to use consistent danger button and spinner styles.

**Acceptance Criteria:**
- [ ] In `src/components/visits/EndVisitButton.tsx`, replace button classes with `btnDanger` + `btnFull` tokens
- [ ] Replace spinner with `spinnerSm` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-019: Normalize LoadingLink spinner
**Description:** As a developer, I want the LoadingLink component to use the shared spinner token.

**Acceptance Criteria:**
- [ ] In `src/components/LoadingLink.tsx`, replace spinner classes with `spinnerSm` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-020: Normalize login page buttons and input
**Description:** As a user, I want the login page to use consistent button and input styles.

**Acceptance Criteria:**
- [ ] In `src/app/page.tsx`, replace "Sign in with Google" button with `btnSecondary` + `btnLg` + `btnFull` composition
- [ ] Replace "Enter School Passcode" button with `btnSecondary` + `btnLg` + `btnFull`
- [ ] Replace "Continue" button with `btnPrimary` + `btnLg` + `btnFull`
- [ ] Replace passcode input with `input` token (keep additional center/tracking styles)
- [ ] Replace login card `shadow-lg` with `shadow-sm`
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-021: Apply PageHeader and tokens to dashboard page
**Description:** As a PM, I want the dashboard page to use the shared PageHeader and consistent card/button tokens, with a mobile-friendly visit table.

**Acceptance Criteria:**
- [ ] In `src/app/dashboard/page.tsx`, replace the inline header with `PageHeader` component (include nav links if the page has them)
- [ ] Replace stat cards with `cardPadded` token
- [ ] Replace "Start Visit" button with `btnSuccess` + `btnSm`
- [ ] Replace alert boxes with `alertWarning` token
- [ ] Add mobile card view for the visits table: `hidden sm:block` on `<table>`, `sm:hidden` on a card-based list showing school name, date, status badge, and continue/view link
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-022: Apply page shell and tokens to visits list page
**Description:** As a PM on mobile, I want the visits list page to have a proper header, page shell, and mobile-friendly tables.

**Acceptance Criteria:**
- [ ] In `src/app/visits/page.tsx`, wrap page in `pageShell` + `PageHeader` + `pageMain`
- [ ] Replace "Continue" button in table with `btnPrimary` + `btnSm`
- [ ] Add mobile card view for both "In Progress" and "Completed" tables (same `hidden sm:block` / `sm:hidden` pattern as dashboard)
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-023: Apply page shell and tokens to visit detail page
**Description:** As a PM, I want the visit detail page to have a proper header and consistent styling.

**Acceptance Criteria:**
- [ ] In `src/app/visits/[id]/page.tsx`, wrap page in `pageShell` + `PageHeader` (with `backHref`) + `pageMainNarrow`
- [ ] Remove the loose `← Back to Dashboard` text link (PageHeader handles back navigation)
- [ ] Replace card `shadow` with `shadow-sm`
- [ ] Replace alert boxes with appropriate alert tokens (`alertError`, `alertSuccess`, etc.)
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-024: Apply page shell to new visit page
**Description:** As a PM, I want the new visit page to be wrapped in the standard page shell.

**Acceptance Criteria:**
- [ ] In `src/app/school/[udise]/visit/new/page.tsx`, wrap the content in `pageShell` + `pageMain` (or `pageMainNarrow`)
- [ ] Verify `NewVisitForm` renders correctly within the new shell
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-025: Verify school page uses PageHeader correctly
**Description:** As a developer, I want to confirm the school detail page already uses `PageHeader` and doesn't need changes.

**Acceptance Criteria:**
- [ ] Read `src/app/school/[udise]/page.tsx` and verify it uses `PageHeader`
- [ ] Verify it wraps in `pageShell` / `min-h-screen bg-gray-50` — add if missing
- [ ] No unnecessary changes if already correct
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-026: Apply PageHeader and tokens to admin index page
**Description:** As an admin, I want the admin index page to use the shared PageHeader and card tokens.

**Acceptance Criteria:**
- [ ] In `src/app/admin/page.tsx`, replace the inline header with `PageHeader` component
- [ ] Replace cards with `cardHover` + `p-6` tokens
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-027: Apply PageHeader to admin users page
**Description:** As an admin, I want the admin users page to use the shared PageHeader.

**Acceptance Criteria:**
- [ ] In `src/app/admin/users/page.tsx`, replace the inline header with `PageHeader` (with `backHref="/admin"`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-028: Normalize AddUserModal tokens
**Description:** As a developer, I want the add user modal to use shared tokens instead of locally defined class strings.

**Acceptance Criteria:**
- [ ] In `src/app/admin/users/AddUserModal.tsx`, replace local `inputClassName` and `labelClassName` with imports from `ui.ts`
- [ ] Replace modal backdrop/container with modal tokens
- [ ] Replace buttons with `btnSecondary`/`btnPrimary` tokens
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-029: Normalize UserList button
**Description:** As a developer, I want the user list's "Add User" button to use the shared token.

**Acceptance Criteria:**
- [ ] In `src/app/admin/users/UserList.tsx`, replace "Add User" button classes with `btnPrimary` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-030: Apply PageHeader to admin schools page
**Description:** As an admin, I want the admin schools page to use the shared PageHeader.

**Acceptance Criteria:**
- [ ] In `src/app/admin/schools/page.tsx`, replace the inline header with `PageHeader` (with `backHref="/admin"`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-031: Normalize SchoolList tokens
**Description:** As a developer, I want the admin school list to use shared tokens for cards, inputs, modals, and buttons.

**Acceptance Criteria:**
- [ ] In `src/app/admin/schools/SchoolList.tsx`, replace stat cards with `card` + `p-4` tokens
- [ ] Replace search input with `input` token
- [ ] Replace select with `input` token
- [ ] Replace modal backdrop/container with modal tokens
- [ ] Replace buttons with `btnSecondary`/`btnPrimary` tokens
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-032: Apply PageHeader to admin batches page
**Description:** As an admin, I want the admin batches page to use the shared PageHeader.

**Acceptance Criteria:**
- [ ] In `src/app/admin/batches/page.tsx`, replace the inline header with `PageHeader` (with `backHref="/admin"`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-033: Normalize BatchList select
**Description:** As a developer, I want the batch list select to use the shared input token.

**Acceptance Criteria:**
- [ ] In `src/app/admin/batches/BatchList.tsx`, replace select element classes with `input` token
- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)

---

### US-034: Review all changes and document findings
**Description:** As a developer, I want to review all changes made during this feature implementation to ensure nothing was missed and document the results.

**Acceptance Criteria:**
- [ ] Use explore agents to understand the current state of all modified files
- [ ] Review git diff to see all changes made
- [ ] Verify no unintended side effects or missing pieces
- [ ] Run `npm run lint` — passes
- [ ] Run `npm run build` — passes
- [ ] Create `ralph/ui-consistency-review.txt` with concise findings (under 50 lines)
- [ ] Review file summarizes: what was done, files changed, any concerns or recommendations

---

## Functional Requirements

- FR-1: Create `src/lib/ui.ts` exporting Tailwind class-string constants for inputs, buttons, cards, badges, spinners, tabs, labels, alerts, modals, and page shells
- FR-2: Remove Arial font override and dark-mode media query from `src/app/globals.css`; ensure Geist font renders
- FR-3: Fix duplicate student count in `SchoolCard` — render count exactly once
- FR-4: Extend `PageHeader` with optional `nav` and `badge` props; add mobile-responsive layout
- FR-5: Replace all inline header implementations across dashboard, visits, and admin pages with the `PageHeader` component
- FR-6: Replace all locally-defined input/button/modal/spinner class strings with imported tokens from `ui.ts`
- FR-7: Normalize all card shadows to `shadow-sm`
- FR-8: Normalize all tab active/inactive colors to `blue-600` / `gray-500`
- FR-9: Fix broken spinner in `PerformanceTab` (border-only → proper circular spinner)
- FR-10: Add page shell (`min-h-screen bg-gray-50`) to visits list, visit detail, and new visit pages
- FR-11: Add mobile card view for visit tables on dashboard and visits list page (`hidden sm:block` table + `sm:hidden` card list)
- FR-12: Make `StudentTable` expanded grid and `ProgressSummary` grid responsive (`grid-cols-1 sm:grid-cols-3`)
- FR-13: Make `NewVisitForm` button layout stack vertically on mobile (`flex-col sm:flex-row`)

## Non-Goals

- No new React component library — tokens are just string constants
- No dark mode support — the app is light-only
- No admin page mobile card views — admin is a desktop workflow
- No changes to API routes, database queries, or business logic
- No new pages or features — purely visual normalization
- No unit tests for styling changes (visual only)
- No changes to `StatCard` (already clean) or `Pagination` behavior (only shadow normalization)

## Design Considerations

- **Token approach:** Plain string constants in `ui.ts`, not a component library. Components import and use them as `className` values. This is the simplest approach that prevents drift.
- **Size overrides:** `btnSm`, `btnLg`, `btnFull` use `!important` prefixed Tailwind classes (e.g., `!px-3`) so they can compose with base button tokens without specificity issues.
- **Existing PageHeader:** Extended with new optional props rather than replaced — zero breaking changes to the school page that already uses it.
- **Mobile table pattern:** Inline `hidden sm:block` / `sm:hidden` per page rather than a reusable `ResponsiveTable` component. Only 2-3 tables need it, so a component abstraction would be premature.

## Technical Considerations

- **Tailwind v4:** This project uses Tailwind CSS v4. Verify that `!important` prefix syntax (`!px-3`) works in v4 — if not, use standard override approach.
- **Class merging:** Token composition (`${btnPrimary} ${btnSm}`) relies on later classes winning. If conflicts arise, consider adding `tailwind-merge` as a dependency or adjust token design.
- **No runtime cost:** All tokens are static strings resolved at build time — zero performance impact.

## Success Metrics

- `npm run lint` passes with zero errors
- `npm run build` succeeds with zero errors
- Every page wraps in the standard page shell pattern
- Every input, button, spinner, tab, card, and modal uses imported tokens from `ui.ts`
- No duplicate student counts visible
- Geist font renders on body (not Arial)
- No dark mode flash on dark OS settings

## Open Questions

- Should `tailwind-merge` be added as a dependency for safer class composition, or is raw string concatenation sufficient?
- Should the `PageHeader` sign-out use the NextAuth `signOut()` function (client-side) or continue linking to `/api/auth/signout`?
- Are there any pages not listed in the brainstorming doc that also need normalization?
