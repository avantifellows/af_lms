---
name: student-addition
description: Context for the Lakshya/JNV self-service student addition feature: one-by-one lateral entry, bulk upload, DB Service writes, validation, and permissions.
triggers:
  - "student addition"
  - "bulk upload"
  - "lateral entry"
  - "create-with-enrollments"
  - "G10 board"
edges:
  - target: context/architecture.md
    condition: when seeing how the school page, LMS API route, and DB Service connect
  - target: context/data-access.md
    condition: before writing create/update/dropout/document mutations
  - target: context/permissions.md
    condition: before gating create/bulk/edit/delete routes
  - target: patterns/add-api-route.md
    condition: when adding LMS API routes for create or bulk upload
  - target: patterns/db-service-write.md
    condition: when proxying student writes to the DB Service
last_updated: 2026-07-16
---

# Student Addition

Source context: GitHub issue https://github.com/avantifellows/af_lms/issues/197 is the current revised implementation PRD. Issue #155 describes the prior implementation and issue #144 remains reference context only.

## Settled Product Shape
- v1 is JNV PMU / JNV NVS only. In current LMS code this is `PROGRAM_IDS.NVS` (`64`, label `JNV NVS`) from `src/lib/constants.ts`.
- Rollout plan is staff/PMs first, then schools after real upload feedback. In the #155 implementation build, student writes are allowed only for `admin`, `program_manager`, and `program_admin`; teachers/staff roles, school-login/passcode users, and `read_only` users cannot create, bulk upload, edit, or dropout students.
- Both one-by-one add and bulk upload live inside `/school/[udise]`; there is no school selector.
- School is resolved from the page route context server-side. Never read school from the form or uploaded file. Ignore any school column if present.
- Bulk v1 uses synchronous `.xlsx` upload -> results table -> downloadable rejected-rows CSV -> user fixes offline and re-uploads that CSV directly. No editable in-browser preview and no drafts table for v1.
- Deferred v2 idea: LLM/fuzzy cleanup pre-pass that suggests fixes only. Never auto-commit generated corrections.

## Template Fields
Canonical v1 fields live in PRD §6.2. Use that table as the field/API/DB contract; the spreadsheet exports are supporting evidence only.

Current v1 fields:
- Grade -> `g12_graduating_year` context and grade enrollment
- Student Name -> `user.first_name` contains the full name in v1
- Date of Birth -> `user.date_of_birth`
- Gender -> `user.gender` (`Female`, `Male`, `Other`; legacy `Others` input normalizes to `Other`)
- Category -> `student.category`
- CWSN -> `student.physically_handicapped`, with Yes mapping the base category to its `PWD-*` value
- PEN -> `student.pen_number`; historical APAAR remains read-only identity context
- G10 board -> `CBSE` or `Others`; persist `CBSE` and map `Others` to `null`
- Grade 10 Roll no -> new DB Service field `student.g10_roll_no`; also used to compose `student.student_id` when present
- Board Stream -> `student.board_stream`
- Primary Exam preparing for -> `student.stream`
- Father Name -> `student.father_name`
- Parents Phone Number -> `user.phone`
- Yearly / Annual Family Income -> `student.annual_family_income`

Father Name and Annual Family Income are optional in v1. Store them when present, validate Annual Family Income against the dropdown if present, and do not block creation when either is blank.

Dropdowns come from the template exports. CBSE is the only board with an enforced numeric G10 roll format: exactly 8 digits. Other boards accept normalised alphanumeric Grade 10 rolls between 4 and 10 characters.

No open implementation decisions remain in the PRD. School-login support/recovery is an ops runbook detail and intentionally out of scope for this implementation artifact.

Audit minimums are decided in the PRD: capture actor, school/program scope, action, timestamp, upload id/filename/row counts for bulk, affected student identifiers, and important old/new values for edits/deletes.

For school-change boundary, v1 behavior is decided: same-school duplicate says the student is already part of this school and shows the Student ID; another-school duplicate shows existing-match details on UI and errors out. V1 does not transfer students between schools.

School-login ops details such as credential delivery, teacher/principal change, password loss, and school email access loss are out of scope for this PRD.

Edit/dropout scope is decided: the PM/staff rollout uses the same school-scoped flow intended for later school users. Allowed write actors can edit normal profile/detail fields, grade, and stream; grade/stream changes must re-derive batch using the PRD rule and commit atomically with the student update. Student ID, PEN, G10 roll, and historical APAAR cannot be edited after creation in v1. Dropout is program-specific: it ends only the selected program's current batch enrollment and group membership. Other programs, grade, school, and global student status stay active while any current program remains; global dropout happens only after the final program ends.

Enrollment date handling is decided: LMS supplies DB Service `start_date` and `academic_year`; schools do not enter them. For creates, `start_date` is the successful creation date in Asia/Kolkata as `YYYY-MM-DD`. `academic_year` is derived from that date using an April-March year: April 1 or later -> `YYYY-YYYY+1`, January-March -> `YYYY-1-YYYY`. Keep this in one shared LMS backend helper for one-by-one and bulk create, with tests around March 31 / April 1. Do not use the hardcoded `CURRENT_ACADEMIC_YEAR` constant or the client-only `StudentTable.tsx` dropout helper for create flows.

## Validation And Normalisation
- PEN or G10 Roll Number: at least one is required; both are allowed. PEN is exactly 11 digits and cannot start with zero pending rollout confirmation.
- Duplicate PEN and duplicate generated Student ID are blocked. Historical APAAR is display-only for this NVS flow.
- Student ID is `<G12 passing-out year><normalised G10 roll>`, no separator, when G10 Roll Number is present. PEN-only rows leave `student.student_id` null.
- G12 passing year is derived from the active academic year, not hardcoded: Grade 11 -> academic-year start + 2, Grade 12 -> academic-year start + 1. For AY26-27 this means Grade 11 -> 2028 and Grade 12 -> 2027.
- G10 roll normalisation: CBSE preserves an exact eight-digit text value. Others removes non-alphanumerics, uppercases, removes leading zeroes, then requires 4-10 characters.
- Name normalisation: collapse spaces, remove full stops, proper-case words. Show the normalised value back before commit.
- Bulk upload has no separate Grade selector; each nonblank row supplies Grade 11 or 12 and mixed-grade files are valid.
- Batch assignment is system-driven from grade x `stream`, not `board_stream`. Derive the batch using NVS program + batch metadata only; require exactly one match.
- Auth group is the constant `EnableStudents`.

## LMS Code Context
- School page gate and enrollment tab live in `src/app/school/[udise]/page.tsx`.
- The page already resolves school by UDISE/code and checks passcode user scope or `canAccessSchoolSync`.
- `students` feature access currently grants edit to all roles, passcode users get students edit, and `read_only` downgrades edit to view in `getFeatureAccess`.
- Existing `NVS_GATED_FEATURES` does not include `students`, so Student Addition needs its own explicit `PROGRAM_IDS.NVS` allowlist check.
- `canAccessStudent(session, id, { requireEdit: true })` is the right pattern for generic existing-student writes. Student Addition existing-student writes use `requireStudentAdditionStudentAccess(session, studentPkId)`, which starts from the opaque Student PK, gates before route-level row lookup, requires `school.af_school_category = 'JNV'`, and checks school scope, `students` edit, actor NVS access, and current NVS Batch enrollment without querying or requiring a Centre.
- For create/bulk there is no existing student to resolve, so gate by resolved school: Google session -> resolved permission -> JNV school category -> allowed role -> `students` `canEdit` -> School/region scope -> actor NVS scope. The create gate does not query or require a Centre and ignores `school.program_ids`; passcode users and non-JNV schools remain blocked.
- Slice #157 adds the shared LMS create gate in `src/lib/student-addition-access.ts`, client-safe field/identity helpers in `src/lib/student-addition-fields.ts`, and the IST enrollment date helper in `src/lib/lms-enrollment-date.ts`.
- One-by-one creation now uses `POST /api/school/[udise]/students`, which validates one canonical row, derives actor/school/program/start-date/academic-year server-side, and proxies DB Service `POST /api/lms/students/bulk-create-with-enrollments` with a single-row payload.
- Bulk creation also uses `POST /api/school/[udise]/students` with only a multipart `.xlsx`/`.csv` file. LMS parses only the `Template` sheet, normalises real Excel date cells, validates mixed Grade 11/12 files with up to 200 nonblank rows locally, sends accepted rows to the same DB Service endpoint, and merges local rejects with DB Service statuses.
- `GET /api/school/[udise]/students` serves the checked-in official `src/assets/nvs-student-addition-template.xlsx` after authorization. The asset retains `Template`, `Dropdown values`, formatting, validations, and prepared rows; `Field details` is removed and no runtime workbook is generated.
- Rejected-row CSV contains only rejected rows, retains original row numbers and canonical PEN inputs, includes safe Student ID/PEN/historical APAAR match context, escapes spreadsheet formulas, and can be uploaded directly through the same parser.
- The school enrollment tab shows `Add Student` and `Bulk Upload` only when the shared Student Addition gate passes and NVS is selected; the gate is Centre-free but JNV-only.
- `AddStudentModal` reuses the canonical validator and exposes PEN, CWSN, CBSE/Others, `Other`, and NDA. It shows local and safe upstream field errors inline, previews the generated Student ID, and refreshes the roster after creation.
- Existing-Student Edit uses the shared Student Addition existing-Student gate before proxying canonical changed fields to DB Service `PATCH /api/lms/students/:student_id/update-with-enrollments`. The gate requires one current School and a current NVS Batch plus actor Program, role, feature, and School scope checks, but does not query or require a Centre. The shared field helper filters locked and ownership fields and applies the canonical name, contact, DOB, gender, CWSN/category, board, Grade 11/12, and NDA rules before the route derives actor/School/Program/enrollment context and safely maps upstream field errors. The roster shows Edit only for rows with a current NVS Batch. The modal keeps Student ID, PEN, G10 roll, and historical APAAR disabled even when blank, sends only changed fields (with CWSN/category as a pair), does not expose manual Batch selection, and refreshes the roster after success.
- The enrollment tab uses all current batch program IDs, so a student enrolled in CoE and NVS appears in both program views and counts. Program-dropout audits provide `dropout_program_ids`, allowing the same student to appear as CoE Dropout and NVS Active at the same time.
- Dropout accepts the opaque `student_pk_id` plus an explicit `program_id`. NVS reuses the Centre-free JNV-only existing-Student gate and derives Student ID or PEN server-side; other Programs retain their existing Centre-based Program dropout gate and Student ID or historical APAAR fallback. Non-admin actors need the target Program in their resolved scope, while the existing global-admin exception remains for newer centre Programs that are not in the hand-maintained JNV Program constants. Both paths proxy LMS `POST /api/student/dropout` to the DB Service program-dropout contract at `PATCH /api/dropout`.
- LMS-audited DB Service dropout closes only the selected program batch and its group membership. It preserves other program batches, grade, school, and global status; when no current batch remains it applies the existing global dropout flow. Generic non-LMS `/api/dropout` callers retain the existing global behavior.
- Remaining LMS write proxy not safe enough for school rollout: `src/app/api/student/route.ts` only checks `session` before proxying.
- `csv-parse` and `exceljs` are installed in af_lms for upload parsing. Do not add runtime template generation or reintroduce the direct `xlsx` dependency. Rejected-row retry is CSV and includes only `rejected` rows, not skipped/already-existing rows.

## DB Service Context
Repo: `/Users/deepanshmathur/Documents/AF/db-service`.

Existing endpoint: `POST /api/student/create-with-enrollments` in `lib/dbservice_web/controllers/student_controller.ex`.
- Validates `academic_year` and `start_date`.
- In practice, `start_date` is Ecto `:date` and must be ISO-castable; `academic_year` is required for non-auth-group enrollments but is only a string, so LMS must enforce `YYYY-YYYY` itself.
- Requires at least one of `auth_group`, `school_code`, `batch_id`, or `grade`.
- Enriches `grade` into `grade_id`.
- Creates/updates user + student through `Users.create_or_update_student`.
- Creates auth_group, school, batch, and grade enrollments through `Dbservice.DataImport.StudentEnrollment.create_enrollments`.

Important caveat: the endpoint documentation/error branch says "Student already exists", but the current code path calls `Users.create_or_update_student`, which can update an existing student instead of returning `:student_exists`. Do not use it as-is for this feature.

Final PRD decision:
- Add a dedicated create-only LMS bulk endpoint: `POST /api/lms/students/bulk-create-with-enrollments`.
- The one-by-one form sends a single-row payload to the same endpoint.
- Final row statuses are `created`, `duplicate_in_file`, `already_exists`, and `rejected`.
- Existing matches never update records. A consistent PEN or generated Student ID match returns `already_exists`; when both identifiers are supplied they must point to the same record and must not conflict with that record's stored non-null identifier. Safe match context can include Student ID, PEN, and historical APAAR.
- Each created row is transactional across user, student, auth-group enrolment, school enrolment, batch enrolment, and grade enrolment.
- Re-upload is idempotent: already-created rows return `already_exists`, with no duplicate and no overwrite.

Existing-student NVS edit is atomic and program-scoped without a Centre requirement: DB Service requires current Program 64 and exactly one current NVS batch, replaces only that program's batch enrollment/group membership, and leaves other programs untouched. It compares submitted grade/stream values to current values before planning enrollment changes, derives the graduating year from `academic_year`, and rejects invalid phone/DOB values at the service boundary.

DB Service work still needed:
- Add `g10_board` and `g10_roll_no` columns to `student`, cast them in `Dbservice.Users.Student`, and include them in JSON/swagger if the API returns them.
- Add the dedicated create-only bulk endpoint above. Desired v1 behavior from the PRD: LMS validates first, DB Service enforces uniqueness/no-overwrite/ownership, commits good rows, and reports duplicate/existing/rejected rows.

## Batch Mapping
Initial prod check showed `batch.metadata.grade + batch.metadata.stream` was ambiguous for NVS because both old `EnableStudents_11_25` / `EnableStudents_12_25` batches and new Lakshya `2027` / `2028` batches carried the same metadata. The team cleared conflicting metadata on the old batches; prod recheck on 2026-06-30 showed exactly one matching NVS batch for each v1 Grade x Primary Stream pair.

Final PRD rule: derive by `program_id = 64`, metadata grade, and metadata stream. Do not use `end_date` or `inserted_at` as a tie-breaker in v1. If zero or multiple batches match, reject as a system configuration error.

Expected AY26-27 derived values from current DB data:
- Grade 12 Engineering -> stream `engineering` -> `EnableStudents_TP_2027_engg_A001`
- Grade 11 Engineering -> stream `engineering` -> `EnableStudents_TP_2028_engg_A001`
- Grade 12 Medical -> stream `medical` -> `EnableStudents_TP_2027_med_A001`
- Grade 11 Medical -> stream `medical` -> `EnableStudents_TP_2028_med_A001`
- Grade 12 CA -> stream `ca` -> `EnableStudents_TP_2027_ca_A001`
- Grade 11 CA -> stream `ca` -> `EnableStudents_TP_2028_ca_A001`
- Grade 12 CLAT -> stream `clat` -> `EnableStudents_TP_2027_clat_A001`
- Grade 11 CLAT -> stream `clat` -> `EnableStudents_TP_2028_clat_A001`

Assume the team will correct the old batch-id spelling typo before implementation. `No stream` is out of v1.
