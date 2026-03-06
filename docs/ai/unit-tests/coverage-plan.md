# Plan: Increase Unit Test Coverage from 62% → 90%+

## Context

Current unit test coverage is **62.16% lines** (1,219/1,961). The target is **90%+** (≥1,765 lines), requiring **≥546 additional lines** to be covered. There are 24 source files at 0% coverage totaling 718 coverable lines, plus 24 uncovered lines across 11 partially-covered files. All 0% files are either client components (testable with RTL) or async server components (testable by calling as async functions + rendering returned JSX).

Work is organized into 6 phases ordered by impact and difficulty. Phases 1–3 (client components) use established RTL patterns already in the codebase. Phase 4 (server pages) introduces a new pattern for testing async server components. Phase 5 closes gaps in partially-covered files. Phase 6 is cleanup/verification.

---

## Phase 1: Admin Client Components (~80 tests, +234 lines → 74.1%)

All "use client" components. Follow `EditStudentModal.test.tsx` patterns: RTL render, `userEvent.setup()`, `vi.stubGlobal("fetch", mockFetch)`, mock `next/navigation` and `next/link`.

| # | File | V8 Lines | Branches | Tests | Key Focus |
|---|------|----------|----------|-------|-----------|
| 1 | `src/app/admin/users/AddUserModal.tsx` | 81 | 76 | ~30 | Create/edit modes, level-based UI visibility, debounced school search (`vi.useFakeTimers` + `userEvent.setup({ advanceTimers })`), program validation |
| 2 | `src/app/admin/batches/BatchList.tsx` | 60 | 48 | ~18 | Program selector fetch, inline edit mode, save/cancel, loading/error states |
| 3 | `src/app/admin/schools/SchoolList.tsx` | 54 | 42 | ~18 | Search/filter, edit modal with program checkboxes, save, stats display |
| 4 | `src/app/admin/users/UserList.tsx` | 39 | 43 | ~14 | Add/edit/delete flows, self-delete prevention (`vi.stubGlobal("confirm")`), refetch after save |

Test files: colocated as `*.test.tsx` next to each source file.

---

## Phase 2: Curriculum Components (~50 tests, +157 lines → 82.1%)

All "use client" components. Mock `@/lib/curriculum-helpers` functions and `fetch`. For `CurriculumTab`, mock child components as stubs to isolate logic.

| # | File | V8 Lines | Branches | Tests | Key Focus |
|---|------|----------|----------|-------|-----------|
| 5 | `src/components/curriculum/CurriculumTab.tsx` | 63 | 29 | ~15 | Grade/subject fetch, localStorage persistence (mock helpers), tab switching, modal lifecycle, canEdit gating |
| 6 | `src/components/curriculum/LogSessionModal.tsx` | 62 | 58 | ~20 | Date/duration validation, Set-based topic/chapter selection, form validation (no topics + no chapters = error), save callback |
| 7 | `src/components/curriculum/ChapterAccordion.tsx` | 12 | 16 | ~6 | Empty state, chapter expand/collapse, progress indicators |
| 8 | `src/components/curriculum/SessionHistory.tsx` | 17 | 4 | ~5 | Empty state, topic grouping by chapter, date/duration formatting |
| 9 | `src/components/curriculum/ProgressSummary.tsx` | 2 | 0 | ~2 | Stats display from calculateStats helper |
| 10 | `src/components/curriculum/TopicRow.tsx` | 1 | 6 | ~3 | Completed vs uncompleted styling, branch variations |

---

## Phase 3: Client Pages (~30 tests, +81 lines → 86.2%)

| # | File | V8 Lines | Branches | Tests | Key Focus |
|---|------|----------|----------|-------|-----------|
| 11 | `src/app/page.tsx` | 23 | 12 | ~12 | Google OAuth `signIn` call, passcode form toggle, 8-digit validation, success redirect via `router.push`, error display. Mock `next-auth/react` and `next/navigation`. |
| 12 | `src/app/visits/[id]/principal/page.tsx` | 58 | 32 | ~18 | Uses React 19 `use(params)` — pass `Promise.resolve({ id: "1" })` as params. Form load via fetch, field updates, save (PATCH), save & return navigation, error states. |

---

## Phase 4: Server Pages (~60 tests, +235 lines → 98.2%)

**New testing pattern** for async server components:

```ts
// Mock redirect/notFound to throw sentinel errors
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

// For redirect tests:
await expect(Page({ params: ... })).rejects.toThrow("REDIRECT:/");

// For render tests:
const jsx = await Page({ params: Promise.resolve({ id: "1" }) });
render(jsx);
expect(screen.getByText("Dashboard")).toBeInTheDocument();
```

Also mock: `getServerSession`, `query`, all permissions functions, `next/link`, and any child client components as stubs.

**Start with `admin/page.tsx` (7 lines) to validate the pattern**, then scale to complex pages.

| # | File | V8 Lines | Branches | Tests | Key Focus |
|---|------|----------|----------|-------|-----------|
| 13 | `src/app/admin/page.tsx` | 7 | 4 | ~3 | No session → redirect, not admin → redirect, success → render links. **Pattern validation file.** |
| 14 | `src/app/admin/batches/page.tsx` | 17 | 6 | ~3 | Admin check, fetches batches from DB service (mock fetch), renders BatchList |
| 15 | `src/app/admin/schools/page.tsx` | 9 | 4 | ~3 | Admin check, query for schools, renders SchoolList |
| 16 | `src/app/admin/users/page.tsx` | 11 | 4 | ~3 | Admin check, parallel user+region query, renders UserList |
| 17 | `src/app/school/[udise]/visit/new/page.tsx` | 12 | 6 | ~4 | Session + PM access + school access checks, renders NewVisitForm |
| 18 | `src/app/visits/page.tsx` | 13 | 14 | ~6 | Session + PM access, visit filtering (in_progress vs completed), empty state. High branch count needs extra test cases. |
| 19 | `src/app/visits/[id]/page.tsx` | 21 | 36 | ~8 | Session + PM access, visit not found, ownership check, progress calculation. 36 branches → needs thorough testing. |
| 20 | `src/app/dashboard/page.tsx` | 65 | 82 | ~15 | Most complex: 4 DB query mocks, passcode redirect, single-school redirect, permission levels, search, pagination, PM stats. 82 branches → most tests needed. |
| 21 | `src/app/school/[udise]/page.tsx` | 76 | 71 | ~18 | 4 DB query mocks, permission matrix (levels 1-4), feature tab gating, NVS stats, data issues. 71 branches → second most complex. |
| 22 | `src/app/layout.tsx` | 4 | 0 | ~1 | Mock `next/font/google`, verify Providers wrapping + metadata export |

---

## Phase 5: Gap-Closing in Partially Covered Files (~25 tests, +24 lines)

These files have existing tests but uncovered lines/branches. Adding targeted tests closes these gaps.

| # | File | Uncovered Lines | Uncovered Branches | Tests | Key Focus |
|---|------|----------------|-------------------|-------|-----------|
| 23 | `src/app/api/student/[id]/route.ts` | 7 | 3 | ~4 | Student update HTTP failure path, batch update failure path, batch success response parsing |
| 24 | `src/components/QuizAnalyticsSection.tsx` | 3 | 2 | ~2 | Edge UI states (loading/empty data permutations) |
| 25 | `src/components/StudentTable.tsx` | 3 | 6 | ~3 | Conditional rendering edge cases (NVS filtering, dropout display) |
| 26 | `src/lib/permissions.ts` | 2 | 5 | ~3 | Uncovered permission edge cases |
| 27 | `src/components/visits/NewVisitForm.tsx` | 2 | 9 | ~4 | Branch gap: 75% → needs GPS error paths, accuracy warning thresholds |
| 28 | `src/app/api/curriculum/chapters/route.ts` | 2 | 3 | ~2 | Missing topic/subject edge cases |
| 29 | `src/components/EditStudentModal.tsx` | 1 | 1 | ~1 | Single uncovered branch |
| 30 | `src/components/StudentSearch.tsx` | 1 | 5 | ~3 | Branch gap: 78% → search edge cases (empty results, special characters) |
| 31 | `src/components/visits/EndVisitButton.tsx` | 1 | 5 | ~3 | Branch gap: 84% → GPS accuracy edge cases, already-ended visit |
| 32 | `src/lib/geolocation.ts` | 1 | 4 | ~2 | Uncovered timeout/error code branch |
| 33 | `src/app/api/batches/[id]/route.ts` | 1 | 1 | ~1 | Single uncovered line (likely error path) |

**Total Phase 5: +24 lines, ~28 tests**

---

## Phase 6: Utilities + Constants (~6 tests, +11 lines)

| # | File | V8 Lines | Tests | Key Focus |
|---|------|----------|-------|-----------|
| 34 | `src/proxy.ts` | 10 | ~5 | Mock `next-auth/jwt` getToken + NextRequest/NextResponse. Public route passthrough, public route with token → redirect, protected route without token → redirect, protected route with token → passthrough |
| 35 | `src/lib/constants.ts` | 1 | 1 | Assert `JNV_NVS_PROGRAM_ID === 64` |

---

## Coverage Projection

| After Phase | Cumulative Lines Covered | Line Coverage | Total Tests (est.) |
|-------------|-------------------------|---------------|--------------------|
| Baseline | 1,219 | 62.2% | 540 |
| Phase 1 | 1,453 | 74.1% | ~620 |
| Phase 2 | 1,610 | 82.1% | ~670 |
| Phase 3 | 1,691 | 86.2% | ~700 |
| **Phase 4** | **1,926** | **98.2%** | **~764** |
| Phase 5 | 1,950 | 99.4% | ~792 |
| Phase 6 | 1,961 | 100% | ~798 |

**90% threshold crossed during Phase 4** (after ~5 server pages).

Note: 100% line coverage is the theoretical maximum. In practice, some lines may resist unit testing (e.g., catch blocks triggered only by runtime errors). Realistic target: **95-98%** after all phases.

---

## Execution Order

1. **Phase 1** — 4 files can be written in parallel
2. **Phase 2** — 6 files can be written in parallel
3. **Phase 3** — 2 files in parallel
4. **Phase 4** — Start with `admin/page.tsx` to validate server component pattern, then parallelize remaining 9 files
5. **Phase 5** — Can interleave with Phase 4; each file's gap-tests are independent
6. **Phase 6** — Anytime, independent

---

## Verification

After each phase:
```bash
npm run test:unit:coverage
```
Check `unit-coverage/coverage-summary.json` for `total.lines.pct`. Target: ≥90.0%.

Final check:
```bash
npm run test       # All tests pass
npm run build      # No build regressions
```
