---
name: load-blended-learning-links
description: Load or refresh Blended Learning Student Links (Profile Doc, Screener Link, optional legacy last-contact date from the Profile Docs) from the Profile Dashboard workbook with the operator script. Use at rollout and whenever the Sheet's links change.
triggers:
  - "profile doc links"
  - "screener links"
  - "load links"
  - "profile dashboard"
  - "legacy_last_contact_on"
  - "legacy last contact"
  - "blended_learning_student_links"
  - "legacy conversation"
  - "legacy_conversation_summary"
  - "blended:export-latest-entries"
edges:
  - target: context/data-access.md
    condition: for the Blended Learning tables and the Mapping source the script matches against
  - target: context/setup.md
    condition: for the .env files the script reads database credentials from
last_updated: 2026-10-27
---

# Load Blended Learning Student Links

## Context
Mentees' Profile Docs and Screener Links live in the *AY 26-27 - G12 + G13 - Profile Dashboard*
Google Sheet, not the app; there is no in-app link editing. `scripts/import-blended-learning-links.ts`
(`npm run blended:import-links`) reads an `.xlsx` export and upserts
`blended_learning_student_links` by `student_id`. Logic and tests:
`src/lib/blended-learning-links-import.ts` (`runBlendedLinksImport`,
`formatBlendedLinksImportReport`). Re-runnable; **dry run by default**.

What it reads (hyperlinks, never cell text — a Ctrl+K link or a `HYPERLINK("url", …)` formula):
- **`Student Profile Docs` tab** → `profile_doc_url`: the "Profile Doc" column's link, or, with no
  such column, the first hyperlinked cell in the row (e.g. a hyperlinked name).
- **`Conversation` tab** → `screener_url`: the "Screener Form" column's link only. There is no
  row fallback here: with no "Screener Form" header every row is `no_link`, so a hyperlinked
  name or any other link is never written as a Screener Link.
- **`--legacy-docs-dir=<dir>`** → `legacy_last_contact_on`: the latest dated conversation in each
  Student's Profile Doc, read from `<dir>/<Drive file id>.html` (the doc's HTML export). Product
  owner rule (2026-10-23): the doc only, never the Sheet's monthly counts. With docs, every
  matched Student is considered, so one whose workbook rows had no usable link still gets a date
  from a stored Profile Doc link; a Student with no link anywhere and no stored row gets no row.
  Extraction (`src/lib/blended-learning-profile-doc-dates.ts`,
  deterministic, no LLM) skips the intake/profile and Student Story tabs, dates in tables,
  mid-sentence dates, date lines with nothing under them, and dates outside 1 April of the
  academic year to today, IST (a later date is a typo or a plan). A year-less
  date ("17 October", "17/10") is read in the academic year's first year (product owner,
  2026-10-23), except in a tab whose dated entries all carry an earlier year (a G13 doc's
  previous-year history). Outcomes per Student:
  `dated`, `no_dates` (doc read, nothing dated → NULL), `unreadable` (no export → stored value
  kept, NULL until a re-run has the doc), `no_doc_link`. Counts only are printed.
- **`--legacy-conversations=<file.json>`** (needs `--legacy-docs-dir`) →
  `legacy_conversation_summary`, `legacy_action_items`: the summary and action items of that
  same latest entry, shown to Mentors until they log the Student's first Conversation in the
  app (product owner, 2026-10-27). File shape:
  `{ "<Drive file id>": { "occurredOn": "YYYY-MM-DD", "summary": "...", "actionItems": [{ "text": "...", "owner": "student|mentor|parent" }] } }`.
  Strict: summary non-blank ≤ 2000, ≤ 10 items, item text non-blank ≤ 500, owner one of the
  three; `[]` stores NULL items; anything else makes the entry invalid (stored NULL, listed by
  Student ID with a reason). Per `dated` doc: `loaded` when the entry's `occurredOn` equals the
  doc's date, else NULL as `summary_missing` / `summary_stale` / `summary_invalid`; `no_dates`
  → NULL; `unreadable` / `no_doc_link` keep the stored values. `unused` counts file entries no
  dated doc took. The summaries come from an external step (not in this repo) fed by
  `npm run blended:export-latest-entries -- --legacy-docs-dir=<dir> --out=<file.json>`
  (`scripts/export-latest-profile-doc-entries.ts`, logic in
  `src/lib/blended-learning-profile-doc-export.ts`): `{ "<Drive file id>": { "occurredOn",
  "text" } }` for each dated doc, the entry's plain text from its date line to the next date
  line or the end of its tab (tables included, images and link targets dropped, 20,000
  characters at most; `latestProfileDocEntry`), written with mode 0600; counts only printed.

Each tab's header row is the first of the top ten rows with a "Student ID" or "Name"/"Student
Name" column.

## Steps
1. Download the Sheet as `.xlsx` (File → Download → Microsoft Excel). Keep it outside the repo.
2. Dry run against the target environment (writes nothing):
   `npm run blended:import-links -- --file=/path/to/dashboard.xlsx --env-file=.env.production`
   (or `--env=staging` for `.env.staging`; default `.env.local`).
3. Read the counts and issues. Expect roughly 174 Profile Docs and 127 Screener Links for the
   176 Mentees (Oct 2026 Sheet). Fix the Sheet for any `no_match` / `ambiguous_name` /
   `duplicate_row` you care about, re-download, dry run again.
4. Apply: same command plus `--apply`. For legacy dates, export each readable Profile Doc as
   HTML into a private directory outside the repo named `<Drive file id>.html` (it holds minors'
   PII: delete it afterwards), add `--legacy-docs-dir=<dir>`, dry run, then apply. Re-run the
   same way when more docs are shared; unchanged Students are not rewritten.
4b. Latest conversations (needs db-service `20261027100000` deployed): run
   `npm run blended:export-latest-entries -- --legacy-docs-dir=<dir> --out=<private>/entries.json`,
   have the external step write the summaries file, then dry run the import with
   `--legacy-docs-dir=<dir> --legacy-conversations=<private>/summaries.json`, check the
   counts (expect `summary_stale` 0 unless docs changed since the export), then apply. Delete
   both JSON files afterwards: they hold minors' records.
5. Re-run the dry run: it should report `inserted 0, updated 0`, i.e. everything `unchanged`.

## Matching and reporting
- A row matches a Student with an active current-year Blended Learning Mapping by the
  workbook's Student ID (`student.student_id`) when present. A Student ID with no active Mapping
  is `no_match` — no name fallback. With no Student ID, an exact normalised name match
  (case, spacing, punctuation and accents ignored) within the active Mappings; two Mentees with
  that name → `ambiguous_name`. Nothing is guessed.
- Two rows in one tab giving one Student different links → both `duplicate_row`, neither used.
- **Counts per row:** matched (usable link), unmatched (`no_match`, `ambiguous_name`,
  `duplicate_row`), skipped (`no_link`, `not_https` — anything not `^https://\S+$`, matching
  the DB CHECK).
- **Writes:** inserted / updated / unchanged per Student (a dry run shows what apply would do).
  A link missing from the workbook keeps the stored one; the script never clears a column.
- Output is tab, row number and Student ID only — never names, phones or URLs.
- A missing tab, or one without a Student ID / Name header, is listed as "Not read" and the
  script exits 1.

## Verify
- `npx vitest run src/lib/blended-learning-links-import.test.ts src/lib/blended-learning-legacy-conversations.test.ts src/lib/blended-learning-profile-doc-export.test.ts src/lib/blended-learning-profile-doc-dates.test.ts`
- After apply, a Mentee's detail page shows the Profile Doc / Screener links.

## Debug
- Everything `no_match`: the export lost the Student ID column header, or you pointed at the
  wrong environment (Mappings differ per DB).
- Everything `no_link`: the Sheet's links are plain URL text, not hyperlinks — the script does
  not read text by design. On the `Conversation` tab alone, it also means the export has no
  "Screener Form" header in its top ten rows.
