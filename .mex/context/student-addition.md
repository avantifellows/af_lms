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
last_updated: 2026-07-14
---

# Student Addition

Source context: GitHub issue https://github.com/avantifellows/af_lms/issues/155 is the current Ralph-formatted implementation PRD. Issue #144 remains the source/reference PRD for comparison only. The local `lms-user-addition-discord-thread/` folder remains source evidence only; treat the Discord transcript, template CSV exports, and `Board_Values.numbers` preview as source evidence only when auditing whether the PRD is missing context.

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
- Gender -> `user.gender` (`Female`, `Male`, `Others`)
- Category -> `student.category`
- Physical Handicapped / Vikalang -> `student.physically_handicapped`
- APAAR ID -> `student.apaar_id`
- G10 board -> new DB Service field needed
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

Edit/dropout scope is decided: the PM/staff rollout uses the same school-scoped flow intended for later school users. Allowed write actors can edit normal profile/detail fields, grade, and stream; grade/stream changes must re-derive batch using the PRD rule and commit atomically with the student update. APAAR ID and G10 roll cannot be edited after creation in v1. The school-facing destructive action is Dropout, not Delete; it marks `student.status = "dropout"` through DB Service and hides the student from the active roster.

Enrollment date handling is decided: LMS supplies DB Service `start_date` and `academic_year`; schools do not enter them. For creates, `start_date` is the successful creation date in Asia/Kolkata as `YYYY-MM-DD`. `academic_year` is derived from that date using an April-March year: April 1 or later -> `YYYY-YYYY+1`, January-March -> `YYYY-1-YYYY`. Keep this in one shared LMS backend helper for one-by-one and bulk create, with tests around March 31 / April 1. Do not use the hardcoded `CURRENT_ACADEMIC_YEAR` constant or the client-only `StudentTable.tsx` dropout helper for create flows.

## Validation And Normalisation
- APAAR ID or G10 Roll Number: at least one is required; both are allowed.
- Duplicate APAAR and duplicate generated Student ID are blocked. Policy is first-registrant-wins.
- Student ID is `<G12 passing-out year><normalised G10 roll>`, no separator, when G10 Roll Number is present. APAAR-only rows store `student.apaar_id` and leave `student.student_id` null.
- G12 passing year is derived from the active academic year, not hardcoded: Grade 11 -> academic-year start + 2, Grade 12 -> academic-year start + 1. For AY26-27 this means Grade 11 -> 2028 and Grade 12 -> 2027.
- G10 roll normalisation: remove spaces, uppercase letters, then validate. CBSE must be exactly 8 digits; other boards must be 4 to 10 alphanumeric characters. Do not left-pad short rolls. Store the normalised Grade 10 Roll no separately from generated Student ID because Student ID is not equivalent to Grade 10 Roll no across programs.
- Name normalisation: collapse spaces, remove full stops, proper-case words. Show the normalised value back before commit.
- The file grade must match the upload context grade.
- Batch assignment is system-driven from grade x `stream`, not `board_stream`. Derive the batch using NVS program + batch metadata only; require exactly one match.
- Auth group is the constant `EnableStudents`.

## LMS Code Context
- School page gate and enrollment tab live in `src/app/school/[udise]/page.tsx`.
- The page already resolves school by UDISE/code and checks passcode user scope or `canAccessSchoolSync`.
- `students` feature access currently grants edit to all roles, passcode users get students edit, and `read_only` downgrades edit to view in `getFeatureAccess`.
- Existing `NVS_GATED_FEATURES` does not include `students`, so Student Addition needs its own explicit `PROGRAM_IDS.NVS` allowlist check.
- `canAccessStudent(session, id, { requireEdit: true })` is the right pattern for generic existing-student writes. Student Addition existing-student writes use `requireStudentAdditionStudentAccess(session, studentPkId)`, which starts from the opaque student PK, gates before route-level row lookup, checks school scope, `students` edit, actor NVS access, and an active `centres` row for the school's NVS program.
- For create/bulk there is no existing student to resolve, so gate by resolved school: session -> route `[udise]` -> school code -> `canAccessSchool` -> allowed role -> `students` `canEdit` -> not `read_only` -> actor NVS access -> active `centres` row for NVS. Ignore `school.program_ids` and existing-student batch history for this allow decision. Passcode users can view their school roster but are explicitly blocked from Student Addition writes in this build.
- Slice #157 adds the shared LMS create gate in `src/lib/student-addition-access.ts`, client-safe field/identity helpers in `src/lib/student-addition-fields.ts`, and the IST enrollment date helper in `src/lib/lms-enrollment-date.ts`.
- One-by-one creation now uses `POST /api/school/[udise]/students`, which validates one canonical row, derives actor/school/program/start-date/academic-year server-side, and proxies DB Service `POST /api/lms/students/bulk-create-with-enrollments` with a single-row payload.
- Bulk creation also uses `POST /api/school/[udise]/students` with multipart `.xlsx`/`.csv` upload. LMS parses `.xlsx` files with ExcelJS from the first sheet or `Template` sheet, normalises real Excel date cells, validates up to 200 non-blank rows locally, sends accepted rows to the same DB Service endpoint, merges local rejects with DB Service statuses, and returns rejected-row CSV data from the UI.
- The same route serves the downloadable `.xlsx` template through `GET /api/school/[udise]/students`.
- The school enrollment tab shows `Add Student` and `Bulk Upload` only when the shared Student Addition gate passes, the selected program is `PROGRAM_IDS.NVS`, and the school has an active NVS centre mapping; the modals live in `src/components/enrollment/AddStudentModal.tsx` and `src/components/enrollment/BulkStudentUploadModal.tsx`.
- `AddStudentModal` reuses the shared validation helper and shows touched-field errors inline, including APAAR ID, G10 roll length, parent phone length, DOB range, required dropdowns, and the APAAR-or-G10 identity requirement. The one-by-one form groups fields into Student Details, Grade 10 Info, Stream, and Family Details; marks required fields with `*`; marks APAAR/G10 roll with `#` plus a bottom note that one of them is compulsory; uses a searchable G10 board datalist; caps parent phone at 10 digits, APAAR at 12 digits, CBSE G10 roll at 8 digits, and other-board G10 roll at 10 characters; and resets whenever the modal closes. Successful creation closes the modal and shows a Student ID popup with an option to add another student before refreshing the roster.
- Existing-student edit uses the shared Student Addition existing-student gate before proxying PRD-safe fields to DB Service `PATCH /api/lms/students/:student_id/update-with-enrollments`. The gate requires one current school and a current NVS batch in addition to active-centre, actor-program, role, feature, and school scope checks. The edit modal sends only changed fields, forwards `last_name` as empty only when the name changes, validates changed phone/DOB values, keeps APAAR/G10 roll/direct Student ID locked, does not expose manual batch selection, and displays DB Service field conflicts inline.
- Dropout now accepts only `student_pk_id` from the UI, authorizes with the shared Student Addition existing-student gate before route-level lookup, derives `start_date` and `academic_year` server-side, and proxies LMS `POST /api/student/dropout` to DB Service `PATCH /api/dropout`.
- DB Service dropout ends current grade/batch enrollments but leaves the group memberships. `getSchoolRoster` therefore keeps same-academic-year dropout rows by using their latest historical grade/batch enrollment for display/program attribution.
- Remaining LMS write proxy not safe enough for school rollout: `src/app/api/student/route.ts` only checks `session` before proxying.
- `csv-parse` and `exceljs` are installed in af_lms for upload parsing/template generation. Do not reintroduce the direct `xlsx` dependency; it was removed during PR review hardening. Rejected-row retry is CSV and should include only `rejected` rows, not skipped/already-existing rows.

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
- Existing matches never update records. APAAR match or generated Student ID match returns `already_exists`; if those identifiers point to different students, return `rejected`.
- Each created row is transactional across user, student, auth-group enrolment, school enrolment, batch enrolment, and grade enrolment.
- Re-upload is idempotent: already-created rows return `already_exists`, with no duplicate and no overwrite.

Existing-student edit is atomic and program-scoped: DB Service uses active `centres` eligibility, requires exactly one current batch for the requested program, replaces only that program's batch enrollment/group membership, and leaves other programs untouched. It compares submitted grade/stream values to current values before planning enrollment changes, derives the graduating year from `academic_year`, and rejects invalid phone/DOB values at the service boundary.

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
