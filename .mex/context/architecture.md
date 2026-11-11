---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details or versions are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
  - target: context/data-access.md
    condition: when reading or writing data — which of the 5 backends to use
  - target: context/permissions.md
    condition: when a route or page needs to gate access
  - target: context/visits.md
    condition: when working on PM school visits or visit action types
last_updated: 2026-11-11
---

# Architecture

## System Overview
Next.js 16 App Router monolith. A request hits `src/proxy.ts` (middleware) first — it
redirects unauthenticated users to `/` and logged-in users away from the login page.
Retired passcode JWTs (`src/lib/retired-session.ts`) count as no token, and their
session cookies are cleared.
The request then lands on a Server Component page (`src/app/**/page.tsx`) or a route
handler (`src/app/api/**/route.ts`).

- **Reads** (lists, dashboards, detail pages): the page/route calls `query<T>(sql, params)`
  from `src/lib/db.ts`, a direct PostgreSQL connection pool. This is the dominant path.
- **Writes**: split by entity. Student/batch/quiz-session/document mutations are **proxied**
  to the external DB Service (Elixir/Phoenix) over HTTP with a Bearer token. PM visits and
  curriculum write **directly** to Postgres via `query()`.
- **Analytics reads**: quiz analytics pull from **BigQuery**; the performance dashboard pulls
  from **DynamoDB**. Document files live in **S3**. Session creation publishes to **SNS**.

Every API route gates first: `getServerSession(authOptions)` → a permission check
(`src/lib/permissions.ts`, or `src/lib/visits-policy.ts` for visits) → then data access.

## Holistic Admin navigation state

The Holistic Admin Program selector is represented by the validated `program_id`
query parameter. The client derives its selection from `useSearchParams` and uses
native `history.replaceState(null, "", url)` when the user changes Program. This
preserves unrelated query parameters and the hash, updates Next App Router state,
and keeps the current history entry so native Back and reload restore the Program.
Repeated, invalid or unavailable Program query values use the server-validated
fallback rather than selecting the first repeated query value on the client.

Assignment Coverage School links add the fixed `source=progress` marker. The School
route recognizes only that exact scalar value, and `RosterPage` produces a
program-bearing return link only after the existing School and Holistic access
checks resolve authorized content. The marker supplies navigation context and never
grants access. Ordinary School links and all Centre return paths keep their existing
dashboard behavior; there is no general return-URL or storage framework.

Student drill-downs from a progress-origin School use the fixed `school-progress`
source. Phase links and locked-phase redirects preserve it, and the Student Back
link restores `source=progress` on the School URL. Ordinary School drill-downs
retain `source=school`, so their original dashboard return does not change.

School Assignment Coverage filters (Search, Grade, Mentor, Progress; issue #491)
narrow the table and the 8 summary cards together. Progress has Students &
Progress's options and order, minus Skipped: All Students (`""`), `assigned`,
`pending`, `completed`, `no_active_phase`, `unassigned`. The last four are S&P's
value strings. The first two differ, because S&P's `""` means All Assigned and it
has no `assigned`. Skipped is rare on the current Phase (only after an Admin
re-locks a later Phase), and this view shows such Students as Pending. Pending,
Completed and No active phase mean assigned Students only. Unassigned means no
active Mapping, whatever the Phase. The matching cards, both `derivedSummary` and
the `getHolisticAssignmentCoverageSummary` SQL, count assigned Students only, so
Completed + Pending + No active phase = Assigned. With any filter
active, the cards are derived from exactly the rows shown, the same set as
"Showing N of M Students". With none active, they use the server summary. The
filters live in the School/Centre URL as `hm_search`, `hm_grade`, `hm_mentor` and
`hm_progress` (`src/lib/holistic-coverage-filters.ts`). Any other `hm_` param, such
as the retired `hm_assignment`, is ignored and dropped on the next write. The
prefix keeps them clear of the page's other params (`tab`, `program_id`, `source`,
Enrollment's `grade`/`stream`, and so on). Defaults are omitted, invalid values read
as defaults, and a Mentor that is no longer in the roster reads as All Mentors. The
roster keeps the filters in React state, seeded from `useSearchParams` on mount,
and writes them with native `history.replaceState`: no history entry, and no server
re-render, which `router.replace` would cause. The write waits 300 ms after typing
stops, because browsers throttle rapid `replaceState` calls. It happens at once when
the search box loses focus, on any click inside the roster (so a Student click saves
the filters before the page changes), and on unmount while the page is unchanged (a
School tab switch). `SchoolTabs` builds its next URL from the live
`window.location.search` rather than its `useSearchParams` snapshot, which can lag
behind a `replaceState` because Next applies it in a transition. A remounted roster
reads the live URL for the same reason, but only when that URL is its own page.
That page is fixed at mount from `usePathname` and `useSearchParams`, as the path
plus every non-`hm_`, non-`tab` param (`coveragePageKey`). During an in-app
navigation, Next renders the new page before it updates the browser URL, so a
Centre switch or a Program change would otherwise inherit the previous page's
filters. Every write (debounced, click, blur, unmount) is skipped once the browser
URL is a different page, such as another Centre or the Program choice screen after
Back. A blank or spaces-only search is left out
of the URL. The input's `maxLength` and the URL reader share
`MAX_COVERAGE_SEARCH_LENGTH` (100). Student links carry the same params, plus `centre_id` when the roster was
opened on a Centre page. The Student/Phase page accepts them only for `school` and
`school-progress` sources, cleans them with `coverageReturnQuery`, and keeps them on
Phase links and locked-Phase redirects. Its back link goes to
`/centre/<id>?tab=holistic_mentorship` only when the source is `school` and
`centre_id` is set (Centre pages never send `school-progress`). Otherwise it goes
to the School URL. Both keep the filters. Before #491, a Centre-opened drill-down returned to the
School page, which a Centre-seated manager cannot open.

## Issue #383 navigation fixes — implemented in PR #394

The feature branch implements every published slice; child issues #389–#393 are
closed and issue #383 remains open while PR #394 awaits review:

- **#389 Visit totals:** both dashboard views use the exact trimmed/case-folded
  count of the actor's owned non-deleted Visits. The capped JNV Recent Visits
  query uses the same owner predicate (see `context/visits.md`).
- **#390 dashboard routing:** `resolveDashboardView` defaults users with resolved
  `hasCoEOrNodal` context to Physical Centres and others to JNV NVS Schools after
  the existing seated/PMU/Holistic hard routes and an explicit valid `?view=`.
  School/Centre returns and JNV pagination name their dashboard view explicitly.
- **#391 card actions:** dashboard School and Centre cards receive no Start Visit
  action. Their primary links and the existing gated Visit entry points on the
  School/Centre pages remain unchanged.
- **#392 filter history:** deliberate Performance choices push reversible entries;
  automatic Grade reconciliation replaces; Back/Forward restores the complete
  URL-backed selection. Rapid choices compose, and stale grade/overview results
  cannot publish over the current state.
- **#393 report and tab history:** reports push one entry, outer tabs follow
  historical `tab`, and in-page report return consumes browser history only when
  its in-memory trail proves the matching overview predecessor. Unknown provenance
  safely replaces away only `session`; obsolete report data and names are inert.

The final follow-up pass also resolves the two low-severity review findings. A
report-to-overview transition recovers a deeply scrolled viewport when the shorter
overview would otherwise sit entirely above it, while preserving scroll when the
overview still overlaps the viewport. Browser coverage now directly proves the
report → Grade push → Enrollment replace → Back journey remounts Performance at
the historical report and Grade.

This is implemented, PR-ready branch behavior, not merged production behavior.
Centre Switcher remains separate in #388. The change adds no schema, API,
permission, or persistent history store. The Ralph PRD/slice artifacts and write
boundaries remain under `.ralph/workspaces/383/`; configured council rounds were
zero, and no ADR conflict was identified.

## Issue #388 Centre-page switcher

**Implemented in PR #402 (stacked on PR #394):**
`getCentreSwitcherEntries(access)` in `src/lib/dashboard-groupings.ts` is the
lightweight list read: `resolveCentreAccess` scope (`all` → no clause, `ids` →
`c.id = ANY($1)`, `schools` → `sch.code = ANY($1)`, empty → no query), filtered
`c.is_active AND c.school_id IS NOT NULL`, no counts. `RosterPage` loads it only
for `scope.kind === "centre"`, after every existing gate, in parallel with the
roster; any failure in School-code expansion, access resolution, or the query
becomes "no switcher" with one fixed `console.error("Centre switcher list
unavailable")`. The client-safe `src/lib/centre-switcher.ts` is the one place for
option logic (current Centre first and merged, `<Program or No Program> · School
(code)` context, name → School → Program → numeric id order, separate `search`
fields, reserved `disambiguator`). `PageHeader` takes an optional `titleBlock`
(default stays the plain `h1`); `src/components/CentreSwitcher.tsx` renders an
`h1` holding only the trigger button and a sibling `listbox` popup, and its single
`select` handler pushes `/centre/<id>` (no-op for the inert Current option).
Tests: `src/app/centre/[id]/page.test.tsx` keeps the real header and query export;
`e2e/tests/centre-switcher.spec.ts` uses `seedCentreSwitcherFixture` /
`removeCentreSwitcherFixture` (`e2e/helpers/db.ts`) and `signInAs`
(`e2e/fixtures/auth.ts`) — the shared fixture contract for #398–#400.

**Search, keyboard, and mobile (#398):** the popup opens with a `combobox` input
("Search Centres", `aria-controls` → the "Centres" listbox) that takes focus however
the popup opens (click, Enter, Space, ArrowDown on the trigger) and starts empty.
`matchesCentreSearch` in `src/lib/centre-switcher.ts` filters on the separate
`search` fields only (trimmed, case-insensitive substring; empty matches all), so
the current Centre stays first when it matches. No match shows "No accessible
Centres match your search" plus "Clear search" (empties and refocuses the input).
ArrowUp/Down/Home/End move `aria-activedescendant` over non-current options only
and scroll the highlighted option into view; the active option is derived from the
filtered list, so filtering it away clears it at once. Enter calls the same `select`
handler as a click (nothing without an active option). Escape anywhere in the popup
and a trigger click close and focus the trigger; popup-level focus-out closes after
Tab/Shift+Tab or a click on another control without moving focus, including from the
empty-state action, while a click on non-focusable content returns focus to the
trigger. Mouse-downs inside the popup and on the trigger are prevented so focus
stays in the input.
Below `sm` the popup is positioned against `PageHeader`'s `<header>` (now
`relative`) and spans its width; from `sm` up it anchors under the title. The
list caps at `60vh`/`max-h-80` and scrolls; the trigger, input, and options are ≥
44px, and long unbroken option names wrap.
Tests: the page seam's `popup › search/keyboard/dismissal` blocks and the 390px
Playwright journey (search by School code → select → Delta loads).

**Tab carry, history, and pending (#399):** `src/lib/roster-tabs.ts` (client-safe)
owns `ROSTER_TAB_IDS` (the eight outer tab ids in display order; `RosterPage`'s
`visibleRosterTabs` is typed by it), `DEFAULT_ROSTER_TAB` (`enrollment`), and
`resolveVisibleTab(rawTab, visibleTabIds, defaultTab)` — raw tab if visible, else
the default if visible, else the first visible tab. `SchoolTabs` and the switcher
both use it, so they agree on which tab a URL shows. `RosterPage` passes the
switcher the source page's visible tab ids and `tabs[0]` as default. `select`
reads `?tab=` from `useSearchParams()` at selection time (tab clicks write it with
`history.replaceState`, never a server prop), resolves it, and pushes
`centreSwitchHref(id, tab)` from `src/lib/centre-switcher.ts`: `/centre/<id>` plus
`?tab=<tab>` only for a non-default roster tab — Grade, stream, report session,
every other parameter, and the hash are dropped, and a hidden/unknown raw tab
resolves to Enrollment, so it is never carried. The push runs inside
`useTransition`; a `navigatingRef` set synchronously before `push` (which returns
`void`) ignores further choices until `isPending` falls back to false. The
`role="status"` sibling of the `h1` shows "Switching Centre…" meanwhile; default
scroll-to-top is kept. The destination re-runs `getCentreWithSchool` and
`canViewCentre` (stale scope → Access Denied), `SchoolTabs` maps a hidden tab to
Enrollment, a Program-less target keeps program-scoped tabs with
`NoCentreProgram`, and Performance adds its own default Grade by `replace` — one
history entry per switch, and Back restores the source's untouched query/report.
Tests: the page seam's `where a switch lands` block (literal pushed URLs, a
same-turn double click inside one `act`) and `e2e/tests/centre-switcher-history.spec.ts`
(an init-script recorder of `pushState`/`replaceState` proves the first write is the
lone push; held RSC request for the pending case; scope revoked via the test pool).

**Disambiguation ladder (#400):** `getCentreSwitcherEntries` also returns
`typeLabel`/`categoryLabel`, resolved from `c.type_code`/`c.category_code` through
`centre_option_sets`/`centre_options` (the admin Centre list's joins; codes stored,
labels shown per ADR 0004; missing → `null`). `buildCentreSwitcherOptions` groups
every option, the current Centre included (it borrows its labels from its own list
row), by exact (name, Program, School name, School code). In a group of two or
more, an entry whose present labels joined with " · " are non-empty and unique in
the group shows them; every other member shows `Centre ID: <id>`; a unique entry
gets no `disambiguator`. So CoE/Nodal Centres at one School (Program differs) show
nothing. `CentreSwitcher` renders it as a second muted line under the Program ·
School context; search, order, keyboard, and `select` are unchanged. Tests: the
page seam's `popup › disambiguation` block (literal visible text plus option-label
join SQL) and the mixed-group cases in `src/lib/centre-switcher.test.ts`.

## Key Components

- **`src/lib/db.ts`** — the `query<T>()` helper over a singleton `pg.Pool` (god node, ~137 edges). Reads and direct writes both go through it. `withTransaction()` for multi-statement writes.
- **`src/lib/permissions.ts`** — the access-control core: `getUserPermission`/`getResolvedPermission`, `getFeatureAccess` (feature×role matrix), `canAccessSchool*`, `isAdmin`. See `context/permissions.md`.
- **`src/lib/visits-policy.ts`** — visit-specific gate (`requireVisitsAccess`, `enforceVisit*`, `buildVisitScopePredicate`, `apiError`). See `context/visits.md`.
- **`src/lib/auth.ts`** — NextAuth v4 config: Google OAuth (+ dev-login personas in non-prod). The `jwt` callback throws on a retired passcode token, signing it out.
- **`src/lib/centres.ts`** — admin-only Centre Management reads and direct writes, including current Grade 11/12 Centre Exam Track mappings. The API accepts only the shared fixed Exam Track codes; mapping unassignment is a hard delete. Legacy Centre Stream storage and configurable options are removed. Admins enter the reviewed initial mappings manually through Centre Management; there is no one-off importer or live Sheet sync.
- **`src/lib/centre-resolver.ts`** — shared fail-closed School + Program resolver for exactly one active physical Centre. Curriculum options use that Centre's Grade-specific Exam Track mappings, annotate Tracks with curriculum-content availability, and reject new logs or standalone Chapter Completion writes outside the current mapping; scopes with retained logs remain available as read-only history. Curriculum Summary (#426) applies the same cardinality rule per Centre: a second active physical Centre at the same School + Program turns the row into a configuration error.
- **`src/lib/curriculum-plan-rules.ts`** — pure, client-safe Curriculum Plan domain rules for #417 (academic year, derived Draft/Active/Closed plan status, Summary Class, Primary Exam Track, Chapter status, Chapter Test Status, Behind pill, PCM / PCB subject groups (Physics + Chemistry in both, Maths in PCM, Biology in PCB; JEE Main / JEE Advanced classes show PCM, NEET PCB, a shared JEE Main or JEE Advanced + NEET class both), uncovered tracks, and the chapter timeline's hours window start). Dates are `YYYY-MM-DD` IST strings; session end times are IST wall-clock strings compared by date. No DB access — server modules load data and call it.
- **`src/lib/curriculum-summary.ts`** — server-only Curriculum Summary v2 (#426): `getCurriculumSummary(permission, { programIds, regions, centreIds, grade, asOf, onlyBehind, sort, page, pageSize })`. One set-based SQL pass loads every in-scope active physical JNV Centre with a Centre Exam Track for the Grade (existing level / region / school-code / seat scope, Admin = all Programs) plus its Grade Chapters, Active-plan due dates and earliest in-window (1 Apr of as-of's academic year → as-of, IST) Chapter Completion under any mapped track. The module classifies rows with the rules module (plan / No plan / setup error / no content / configuration error), builds Physics / Chemistry / Maths / Biology pills and PCM Behind / PCB Behind (`subjectGroups`, done/due like the pills, null where the group doesn't apply), counts Tests overdue (plan rows, in total and per pill subject as `testsOverdueBySubject`) or Conducted Chapter Tests (No plan rows) from `loadChapterTestSessions` in **`src/lib/curriculum-chapter-tests.ts`** (#428: new-CMS chapter-test quiz sessions starting within the as-of date's academic year and created or started by the end of the as-of day, attributed to Centre via batch → `school_batch` + batch Program and to Chapter via CMS test `type_params.chapter_id` → majority problem `resource_chapter` (duplicate Chapter rows grouped before counting) → name code, unified across duplicate Chapter rows with `src/lib/chapter-siblings.ts`) and `chapterTestStatus`, then applies the Program, Region and Centre filters in that order (#427 / Q22, `applySummaryFilters` + `filterByOption`; they only narrow scoped rows; `programOptions` come from every scoped row, `regionOptions` from the rows in the chosen Programs, `centreOptions` from the rows in the chosen Programs and Regions, and Program or Centre ids that aren't options are ignored and returned as `selectedProgramIds` / `selectedCentreIds` without them), Only behind (PCM or PCB Behind ≥ 1), sort and pagination in memory. `sortSummaryRows(rows, sort)` (pure, exported) runs before pagination: with no `sort` it is worst first (larger of PCM / PCB Behind desc, Tests overdue desc); a column sort (`sort` = `centre` | `program` | `tracks` | `region` | `physics` | `chemistry` | `maths` | `biology` | `pcm` | `pcb` | `plan`, `dir` = `asc` | `desc`) compares text case-insensitively and pills by Behind then due count, with Centre name A–Z breaking ties; rows without a value in that column (blank text, "—", No plan, error rows) go last in both directions in row-kind order. `getChapterTimeline(permission, centreId, { grade, asOf, hoursWindow })` (#429) reuses the same SQL pass and row builder narrowed to one Centre for the chapter timeline at `/curriculum-summary/centres/[id]` (not found outside the user's Summary rows for the Grade). Its hours (#430) come from a second, timeline-only query over LMS Curriculum Logs at the Centre's School + Program + Grade under any class track within the hours window (`ay` | `30d` | `7d`, ending at as-of): regular logs split to Chapters by topic share (rounded per log), Class Cancellation counts and Doubt Solving minutes by `chapter_id` (activity under a duplicate Chapter row counts toward the class's row for that Chapter), summed across a shared class's tracks without de-duplication; prescribed time is the Primary Exam Track's `prescribed_minutes` per Chapter (`primaryExamTrackForChapter`). The timeline's Chapter table sorts like the Summary (curriculum owner feedback): `parseChapterTimelineSort` / `sortTimelineChapters` (pure, exported) take `sort` = `chapter` | `subject` | `due` | `completed` | `status` | `test` | `hours` | `prescribed` | `cancelled` | `doubt_solving` and `dir`; the page sorts after the subject filter. First click (`defaultChapterTimelineSortDirection`): A–Z for Chapter name and Subject, earliest first for Due and Completed, worst first (`desc`) for Status (Overdue by most days, Done late by most days, Done, Not due) and Chapter Test (Overdue, Scheduled, Not due, Conducted), highest first for the four numbers. Blanks (no date, Not in plan) go last in both directions; ties and blanks keep the default due-date order (stable sort). `splitTimelineAtAsOf(chapters, sort, asOf)` sorts each side of the As of line on its own (due on or before as-of above it; later and undated below), and reports no line when no Chapter has a plan date. Both sorts share `parseColumnSort` and `sortByColumn` in the module, and the pages share `sortableHeaders`, `SortableTableHead` and the cell / column classes (`CELL_CLASS_NAME`, `COMPACT_CELL_CLASS_NAME`, `NUMBER_CELL_CLASS_NAME`, `NUMBER_COLUMN_CLASS_NAME`, `COMPACT_COLUMN_CLASS_NAME`) from `src/app/curriculum-summary/summary-ui.tsx`; `ChapterLabel.tsx` (code small and muted, then name) is shared with the Plan editor's Chapter grid. The timeline header's `subjectGroups` (decision Q24) lists, for each group the class's tracks take, the Summary row's PCM / PCB Behind cell (`progress`, null without an Active plan) and the group's syllabus done / total over the same Chapter list, with no extra SQL.
- **Visit action-type registry** — 7 action types, each a `src/lib/<type>.ts` config/validator + a `src/components/visits/<Type>Form.tsx`, dispatched by `ActionDetailForm.tsx`. Registered in `ACTION_TYPES` (`src/lib/visit-actions.ts`).
- **Analytics clients** — `src/lib/bigquery.ts` (quiz analytics), `src/lib/dynamodb.ts` (performance), each a lazily-initialised singleton client.

## External Dependencies
- **PostgreSQL** — primary datastore, shared with the DB Service and prod. Reads + visit/curriculum writes via `src/lib/db.ts`. Uses Ecto naming (`inserted_at`/`updated_at`, snake_case). Server TZ is UTC.
- **DB Service (Elixir/Phoenix)** — external HTTP API at `DB_SERVICE_URL`, Bearer `DB_SERVICE_TOKEN`. All student/batch/quiz-session/document **writes** route here via `fetch`.
- **BigQuery** (`@google-cloud/bigquery`) — read-only source for quiz analytics (`src/lib/bigquery.ts`); credentials via `GOOGLE_SERVICE_ACCOUNT_JSON`.
- **DynamoDB** (`@aws-sdk/lib-dynamodb`) — read-only source for the performance dashboard deep-dive (`src/lib/dynamodb.ts`).
- **S3** (`@aws-sdk/client-s3`) — student document uploads (`src/lib/s3.ts`), presigned URLs. Bucket shared with prod.
- **SNS** (`@aws-sdk/client-sns`) — `src/lib/sns.ts` publishes session-creation messages.
- **ElevenLabs Scribe (speech-to-text, Dictation #500, ADR 0012)** — the LMS's **first external provider key**, `HOLISTIC_DICTATION_ELEVENLABS_API_KEY` (server-only, sent in the `xi-api-key` header, never logged or sent to the browser). `src/lib/elevenlabs-scribe.ts` `transcribeSpeech` posts one clip to `https://api.elevenlabs.io/v1/speech-to-text` (`model_id=scribe_v2`, `tag_audio_events=false`, no `language_code`/diarization; `?enable_logging=false` only when `HOLISTIC_DICTATION_ELEVENLABS_ZERO_RETENTION=true`), 25 s abort, no retry; its errors carry only a failure class and HTTP status. Verbatim speech-to-text only: any LLM work still belongs in etl-next (ADR 0009).
  - **Dictation UI (#500, slice #510; physical centres only):** the server-rendered Student Phase page (`src/app/holistic-mentorship/students/[studentId]/phases/[phaseId]/page.tsx`) passes `dictation: { enabled, remainingSeconds }` to `StudentPhaseWorkspace`. It is on only when `holisticDictationSettings().enabled` and the workspace isn't `readOnly` (the editing Mentor); `remainingSeconds` comes from `getHolisticDictationRemainingSeconds`. If that read throws (usage table not deployed yet, or a database error) the page still renders with Dictation off and logs only the Postgres error code or error name; don't let a Dictation read block the Notes form. Client code never reads `HOLISTIC_DICTATION_*` and nothing uses `NEXT_PUBLIC_`. A "Dictate" mic toggle (`aria-pressed`, labelled `Dictate: <Question>`, "Recording m:ss" while on; it and Retry are 44 px tall, `min-h-11`, on every screen; the e2e spec checks the Dictate button's size with `expectMinimumTapTarget`, Retry's is not checked) sits under every editable Post-Session answer box (draft and the author's Edit), never on submitted/read-only/locked views. Reusable pieces, for the Follow-up modal (#512): `useDictationRecorder` (one per form; states idle → requesting_mic → recording → transcribing → idle/notice; auto-stops at min(120 s, remaining seconds) with a notice; one box at a time; `discard()` on Submit, Save Changes, Cancel, unmount and `pagehide` stops the mic tracks and ignores a late response), `DictationMicButton` + `DictationStatus` (polite live region under the box), and the pure `appendDictation` (`src/lib/holistic-dictation-text.ts`: trims, one space unless the answer ends in whitespace, `too_long` past `HOLISTIC_ANSWER_MAX_LENGTH`). Words are applied when the response arrives through the same answer-change handler typing uses, so autosave and save paths are unchanged. **Failure states (#511)** live in the same shared hook and `DictationStatus`, so #512 inherits them; the words are in `DICTATION_MESSAGES`. Mic blocked (`NotAllowedError`/`SecurityError`), no mic (`NotFoundError`/`OverconstrainedError`) and unsupported (no `MediaRecorder` or `getUserMedia`) show a notice under the box and send nothing. A 5xx, a 429 that is not `daily_limit`, or a network error enters `failed`, which keeps the clip in memory and shows "Couldn't transcribe. Try again" with **Retry** (resends the same Blob and `duration_ms`); the clip is dropped on success, on a new recording, and by `discard()`. Any other 4xx (signed out, access changed, a clip the route rejects) can't succeed on resend, so it drops the clip and shows "Couldn't send that recording. Reload the page and try again." with no Retry and the mics usable; the `duration_ms` sent is capped at the recording's auto-stop point (min(120 s, remaining seconds)), so a device that slept while recording doesn't send a length the route refuses. `nothing_heard` shows "Didn't catch anything…" and leaves the mic ready. When the browser stops the recorder itself (mic unplugged, permission removed, a call takes the mic) or the recorder reports an error, the hook clears its timers, releases the mic, uploads whatever was recorded (`duration_ms` = time since the recording started) and shows "Recording stopped. Check your microphone." with the result, or, with nothing recorded, uploads nothing and shows that notice with the mics ready. A recording the Mentor stops (Stop or auto-stop) that holds no audio is never sent either: it shows "Didn't catch anything…" at once with the mics ready (one empty-clip check, at the top of `upload`, serves both stop paths). `remainingSeconds` from every response sets the next auto-stop; `429 daily_limit`, or `remainingSeconds` ≤ 0 at load or after a response, puts the form in `unavailable` (daily limit): every mic disabled, the limit message announced under the box that found out and shown (not announced) under the others. A `429 daily_limit` that still reports `remainingSeconds` > 0 (the page's count was stale: another tab or device, an ignored late reply, or a Retry near the limit) instead drops the clip, shows "That recording is longer than the time you have left today." with no Retry, reports the corrected count to both forms and leaves the mics usable; a 429 with 0 or no count still locks. `discard()` returns to that limit state, not idle, when no time is left. **One count for both forms:** `SelectedPhaseContent` holds the page's remaining seconds in `useSharedDictationAvailability` and passes `{ enabled, remainingSeconds, onRemainingSeconds }` to the Post-Session editor and the Follow-up modal. Each recorder reports the server's `remainingSeconds` after a clip through `onRemainingSeconds`, so a clip dictated in one form shortens the other form's next auto-stop, and a form at rest (idle or showing a notice) locks as soon as the count reaches 0, whichever form used the time up. A new count from the server (`router.refresh()`) replaces what the recorders reported, even when it is the same number as before (a new India-time day): the hook compares the `dictation` object itself, which each server render creates anew and client re-renders pass through unchanged, so typing or opening the modal never resets a reported count. The same shared hook holds which form's recorder is busy (`busyKind`, reported by each recorder while `dictationBusy` and released when it stops being busy or unmounts), so while one form records or transcribes every mic in the other form is disabled (`busyElsewhere`), exactly like the other boxes inside a form; nothing is discarded when the other form opens. The limit state is derived from the count when the hook returns its state (`shownState`), so the hook's own state never needs resetting. The Fallow audit in CI counts React hooks toward a function's cognitive complexity (the CI action installs the newest 2.x, which can be stricter than the pinned local version, so check with `npx fallow@<CI version> audit --base origin/main --coverage unit-coverage/coverage-final.json`); the recorder therefore keeps its working parts in one `liveRef`, reads the latest props from `optionsRef`, and leaves the recording timer to `useElapsedMs`. `too_long` shows its notice and leaves the answer (and autosave) untouched. **Follow-up modal (#512):** `AddFollowUpNoteModal` owns a second `useDictationRecorder` (`kind: "follow_up"`, URL from the same `dictationApiUrl`) with a mic + `DictationStatus` under each of the three boxes (target = the Follow-up Question key) when `dictation.enabled`; the words go through the modal's `setDraft`. The modal stays mounted while closed, so `discard()` runs on Save, on every close request (Cancel, Escape, backdrop; before the discard confirmation, so declining it still drops the recording) and on close; unmount and `pagehide` are covered by the hook. Saved Follow-up Note cards and read-only workspaces never get the recorder.
- **Google OAuth** — the only login, via NextAuth, open to any Google account; access comes only from a `user_permission` row. Passcode login was removed (ADR 0007).

## What Does NOT Exist Here
- No ORM — raw parameterised SQL via `pg` only. No Prisma/Drizzle/Knex.
- No direct student/batch/quiz-session/document writes to Postgres — those go through the DB Service. Writing them directly bypasses the source of truth.
- No state library (Redux/Zustand) — React local state + Server Components only.
- No REST/GraphQL client framework — `fetch` directly to the DB Service.
- The DB Service itself lives in a **separate repo** (`/Users/deepanshmathur/Documents/AF/db-service`); migrations and write business logic are there, not here.

## Navigation release verification

LMS #332, #334 and #335 merged into main on September 18 in stack order.
For #335 final head `2b2d3392`, staging job 541 verified the complete nested
School/Student/Phase return journey for global and dedicated Holistic Admins on
EMRS Bhopal, plus reload and ordinary School entry. Punjab Nodal had no staging
phases, so its exact nested RSMS drill-down was covered by regression tests rather
than a live browser claim. Final checks included 3,884 unit tests (3 skipped),
lint/build and a completed Codex review without findings. Merge verification alone
does not establish production deployment. Evidence: sibling
`release-records/holistic-back-navigation-20260917/`.
