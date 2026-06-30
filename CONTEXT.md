# AF LMS

Student enrollment management and PM school-visit tracking for Avanti Fellows — a nonprofit running supplemental education programs in Indian government schools.

## Language

### Enrollment & School

**School**:
A government school enrolled in an Avanti Fellows program, identified by UDISE code.
_Avoid_: Institution, center

**Centre**:
An Avanti billing and funder-facing operational unit that may be linked to a School but can differ from school boundaries.
_Avoid_: Center, School

**Student**:
A learner enrolled at a school, linked via `group_user` membership.
_Avoid_: Learner, pupil

**Batch**:
A grouping of students within a school for program delivery.
_Avoid_: Cohort, section

**Program**:
An Avanti Fellows delivery model within a school, such as CoE, Nodal, or NVS.
_Avoid_: Course, stream

**Centre Stream**:
One or more academic delivery streams attached to a Centre, such as JEE, NEET, or Math Foundation.
_Avoid_: Program, Exam Track, comma-separated stream

**UDISE Code**:
A unique government-issued identifier for a school.
_Avoid_: School ID, school code (internally `school.code` is a separate field)

**Passcode**:
An 8-digit code granting single-school access without Google OAuth. Format: `{schoolCode}XXX`.
_Avoid_: PIN, access code

### Curriculum

**LMS Curriculum Log**:
A soft-deletable dated record of curriculum teaching for a school, program, grade, subject, and exam track, with duration and covered topics.
_Avoid_: Teaching Session, Session, Class Log

**Chapter Completion**:
The current state that a chapter is complete for a school, program, and exam track.
_Avoid_: Completed log, topic coverage

**Curriculum Progress**:
A summary of covered topics, teaching time, and chapter completion for a school-program-grade-subject-exam-track selection.
_Avoid_: Progress record, saved progress

**Curriculum Summary**:
A top-level read-only dashboard for reviewing curriculum progress across schools, grades, subjects, and exam tracks.
_Avoid_: Curriculum tab, curriculum report, curriculum overview

**Exam Track**:
The exam-specific curriculum lens selected by a user, such as JEE Main, JEE Advanced, or NEET.
_Avoid_: Stream, orientation

**LMS Chapter Exam Config**:
An exam-track-specific configuration for a chapter that records whether it is in syllabus, the prescribed lecture time, and the coverage order.
_Avoid_: Timemap, chapter requirement

**Curriculum Config Management**:
An admin-only workflow for changing LMS Chapter Exam Config values that affect all schools using the configured chapter and exam track.
_Avoid_: Curriculum logging, school curriculum setup

### Visits & Actions

**Visit**:
A PM's physical school visit record. Two-state lifecycle: `in_progress` → `completed`.
_Avoid_: Inspection, audit, trip

**Action**:
A discrete task performed during a visit (e.g., classroom observation, teacher interaction). Has its own lifecycle: `pending` → `in_progress` → `completed`.
_Avoid_: Task, activity, checklist

**Action Type**:
One of seven fixed types: `classroom_observation`, `af_team_interaction`, `individual_af_teacher_interaction`, `principal_interaction`, `group_student_discussion`, `individual_student_discussion`, `school_staff_interaction`.
_Avoid_: Category, kind

**Visit Teacher**:
An active Staff Management teacher seated at a Centre linked to the Visit's School and eligible for teacher-related visit actions.
_Avoid_: LMS teacher permission, pending teacher

**Entry** (Individual Student Interaction):
A single interaction record within an `individual_student_discussion` action. Contains one or more students (all same grade) and one shared set of questions. A solo interaction is an entry with one student; a grouped interaction is an entry with multiple students.
_Avoid_: Group (overloaded — `group` is a DB table and `group_student_discussion` is a different action type)

**Soft Delete**:
Setting `deleted_at` timestamp instead of removing the row. Used for actions and (issue #35) visits.
_Avoid_: Archive, deactivate

**School Visit Summary**:
An admin-facing read-only dashboard for reviewing all visits across schools. Two pages: a filterable list view (`/school-visit-summary`) and a per-visit detail view (`/school-visit-summary/[id]`). Distinct from the PM's operational workspace at `/visits/[id]`.
_Avoid_: Visit dashboard, visit report, visit overview

**Remark**:
A freeform text note attached to a question answer within an action's JSONB `data` payload. Used as "visit notes" on the summary detail page.
_Avoid_: Note, comment (these imply a separate entity; remarks live inside action data)

### Roles & Access

**PM (Program Manager)**:
Field staff who conduct school visits. Owns their visits and actions.
_Avoid_: Manager, field officer

**Admin**:
Has scoped read/write access to all visits (same validation rules as PM). Determined by `role = "admin"`.
_Avoid_: Superuser, root

**Program Admin**:
Read-only access to visits within their scope. Cannot create, edit, or delete.
_Avoid_: Viewer, observer

**Permission Level**:
Numeric access scope: Level 3 = all schools, Level 2 = region, Level 1 = specific school codes.
_Avoid_: Access tier, role level

## Relationships

- A **School** has many **Students** (via `group` → `group_user`)
- A **School** has many **Batches**
- A **School** can have many **Centres**
- A **Centre** can be linked to one **School**, but not every **Centre** is school-linked
- **Centre** links to **School** through `school.id`; school code and UDISE code are display/search identifiers, not the Centre relationship key
- A **Centre** name is not globally unique; the same School can have separate billing/funder centres for different operational setups
- In v1, **Centre** rows do not have a uniqueness constraint beyond their primary key
- In v1, **Centre** schema stores `name`, nullable `school_id`, nullable `type_code`, nullable `category_code`, nullable `sub_category_code`, non-null `stream_codes`, `is_physical`, `is_active`, and normal timestamps
- In v1, **Centre** classification fields are current-state fields on the Centre itself, not separate academic-year history records
- In v1, **Centre** rows use normal inserted/updated timestamps without a dedicated audit actor or changelog model
- In v1, **Centre** type, category, and sub-category can be null so incomplete source rows can be imported and cleaned later
- A **Centre** can have multiple **Centre Streams**
- In v1, a **Centre** can have no Centre Streams assigned; empty streams are valid for special rows such as bench teacher buckets
- In v1, **Centre** configurable fields store stable option codes on the Centre row; display labels and ordering come from centre option configuration
- In v1, **Centre** administration includes both a spreadsheet-like Centre grid and a Centre option configuration surface for editing option labels, option active state, and ordering
- In v1, **Centre** administration can create and edit Centre name, linked School, type, category, sub-category, streams, physical status, and active status
- In v1, **Centre** administration displays linked School metadata such as school name, code, UDISE, region, state, and district as read-only values derived from School
- In v1, unlinked **Centres** do not store centre-level location fields; location columns remain blank until the Centre is linked to a School or a later feature adds centre-level location
- In v1, Centre option code validity is enforced by AF LMS APIs and import scripts rather than foreign keys from Centre rows to option rows
- In v1, **Centre** administration is global admin-only reference-data management; it is not scoped by region, school, or Program Admin permissions
- In v1, AF LMS exposes Centre APIs only under admin routes for Centre grid management and Centre option configuration
- In v1, Centre option codes are immutable after creation; admins can edit labels, ordering, and active state without rewriting Centre rows
- In v1, creating a Centre option uses a suggested code derived from the label, but the Admin confirms the code before save; after creation the code is read-only
- In v1, **Centres** are deactivated with `is_active = false`; the admin UI does not hard-delete Centre rows
- In v1, Centre options are deactivated with `is_active = false`; the admin UI does not hard-delete option rows because Centre rows may still reference their codes
- In v1, inactive Centre options remain displayable on existing Centre rows but are not offered for new selections
- In v1, Centre option sets are fixed to type, category, sub-category, and stream; admins configure options inside those sets rather than creating new sets
- In v1, admins cannot create or delete Centre option sets; option set editing, if exposed, is limited to display label and ordering
- In v1, Centre option configuration is stored in `centre_option_sets` and `centre_options`; option sets define fixed fields, while options define stable codes, labels, ordering, and active state
- Centre schema changes are introduced through db-service migrations, while AF LMS owns the data scripts for seeding Centre options and importing the initial Centre CSV data
- AF LMS Centre data scripts are split into two scripts: one seeds fixed option sets and initial options, and another performs the deterministic insert-only Centre row import with a required dry-run mode
- The AF LMS Centre option seed script is rerunnable and may create or update seed-managed option labels/order, but it does not delete options or overwrite unrelated admin-created options
- The initial Centre import is a one-time bootstrap; if it fails, the intended recovery is to clear the new Centre tables and rerun rather than upserting into partially imported data
- The initial Centre import includes all rows from the source `centres.csv`; non-physical, unlinked, or special rows are imported and can be cleaned up later through admin workflows
- The initial Centre import requires a checked-in mapping file with one row per source Centre and explicit school-link status; unresolved or ambiguous mappings block apply mode
- Yearly planning fields such as `plan_status_2627` are out of scope for Centre v1
- Centre v1 should be delivered in slices: db-service schema, AF LMS option seed script, AF LMS Centre import script, admin Centre APIs, Centre grid UI, and Centre option config UI
- A **School** has many **LMS Curriculum Logs**, each scoped to exactly one **Program** and **Exam Track**
- An **LMS Curriculum Log** has many covered topics
- **Chapter Completion** is stored independently from **LMS Curriculum Logs**
- **Curriculum Progress** combines covered topics and teaching time from **LMS Curriculum Logs** with stored **Chapter Completion**
- **Curriculum Summary** aggregates **Curriculum Progress** across multiple **Schools** for PM/admin monitoring
- Each **Curriculum Summary** top-level row represents one School-Program-Grade-Subject-Exam Track combination
- **Curriculum Summary** uses **Chapter Completion** as its source for chapter completion state
- **Curriculum Summary** is the entry point to **Curriculum Config Management** for eligible **Admins**
- In v1, **Curriculum Config Management** is exposed at `/curriculum-summary/config` with the page title `Curriculum Config`
- A chapter has one **LMS Chapter Exam Config** per configured exam track
- **LMS Chapter Exam Config** is global per chapter and exam track, not scoped to a school or program
- **Curriculum Config Management** changes global **LMS Chapter Exam Config** values and is restricted to **Admins**
- In v1, **Curriculum Config Management** edits the live **LMS Chapter Exam Config** rows directly rather than using draft or versioned configs
- In v1, existing **LMS Chapter Exam Config** rows can change syllabus inclusion, prescribed lecture time, and coverage order, but not chapter or exam-track identity
- Adding a new **LMS Chapter Exam Config** row is the controlled path for introducing a new chapter and exam-track pair
- In an add-config flow, grade and subject help admins find the correct chapter; the saved config identity remains chapter and exam track
- In v1, **Curriculum Config Management** does not delete config rows; removing a chapter from syllabus sets it out of syllabus with zero prescribed lecture time after admin confirmation
- In v1, **Curriculum Config Management** supports exporting config rows for review or backup, but not bulk CSV import
- **Curriculum Config Management** changes do not mutate existing **LMS Curriculum Logs** or **Chapter Completion** records
- Before saving a live **Curriculum Config Management** change, admins should see lightweight impact counts rather than a full per-school simulation
- **Curriculum Config Management** may warn about duplicate coverage order values, but duplicate coverage order remains valid in v1
- In-syllabus **LMS Chapter Exam Config** rows may have zero prescribed lecture time; out-of-syllabus rows must have zero prescribed lecture time
- **Curriculum Config Management** is global and is filtered by curriculum structure, not by school or program
- **Curriculum Config Management** uses filters for Exam Track, grade, subject, chapter search, and syllabus status rather than Exam Track tabs
- **Curriculum Config Management** loads data by default, focused on JEE Main in-syllabus rows with grade and subject set to all
- **Curriculum Config Management** edits happen in a modal or side panel, not by inline table editing
- The db-service LMS Chapter Exam Config loader is a one-time bootstrap path; after **Curriculum Config Management** ships, the live config table is maintained through the admin UI
- **Curriculum Config Management** does not reset, reload, or bulk replace config from source CSVs or embedded loader data in v1
- In v1, users select the **Exam Track** explicitly in Curriculum instead of deriving it from teacher, school, or program
- In Curriculum, **Exam Track** is selected before grade and subject; available subjects are filtered by the selected **Exam Track**
- Curriculum chapter order follows **LMS Chapter Exam Config** coverage order before falling back to chapter code
- Deleting an **LMS Curriculum Log** means soft deletion, so covered-topic and teaching-time progress ignores it without losing audit history
- A **PM** creates **Visits** to a **School**
- A **Visit** has many **Actions** (each with an **Action Type**)
- A **Visit** can only be completed when all 7 **Action Types** have at least one completed **Action**
- **Soft Delete** on a **Visit** cascades to its child **Actions**
- A **Visit Teacher** is visible in School Visit teacher pickers because they are visible in Staff Management, not because they have broad LMS teacher permissions
- A **Visit Teacher** uses the active LMS permission ID as its picker identity while Staff Management teacher seating determines list membership
- A **Visit Teacher** picker label uses the Staff Management person name, then active LMS permission name, then email
- A **Visit Teacher** must have an active LMS permission; removing that permission removes them from Staff Management and from School Visit teacher pickers
- A **Visit Teacher** does not require `user_permission.role = "teacher"`; the real teacher profile and teacher-type Centre seat define teacher membership
- A pending Staff Management teacher is not a **Visit Teacher** until they have a real teacher profile and active Centre seat
- An exited Staff Management teacher is not a **Visit Teacher**
- **Visit Teacher** semantics apply consistently to Classroom Observation, AF Team Interaction, and Individual AF Teacher Interaction
- If a **School** has multiple active linked **Centres**, School Visit teacher pickers include **Visit Teachers** from all of those Centres
- A **Visit Teacher** seated at multiple active Centres linked to the same **School** appears once in School Visit teacher pickers
- Teachers seated at inactive **Centres** are not **Visit Teachers** for new School Visit actions
- If Staff Management has no active **Visit Teachers** for a **School**, School Visit teacher pickers show an empty state rather than falling back to LMS teacher permissions
- A **Visit Teacher** must hold a teacher-type Centre seat role, not a PM-type seat role
- Individual AF Teacher Interaction completion validates "all teachers recorded" against the same **Visit Teacher** source used by School Visit teacher pickers
- Existing School Visit action data is not migrated when **Visit Teacher** sourcing changes; saved teacher names remain historical data, while new picker and completion rules use the current **Visit Teacher** source
- `/api/pm/teachers` is the shared School Visit **Visit Teacher** source; Classroom Observation does not get a separate teacher API
- School Visit permissions gate access to **Visit Teacher** pickers; Staff Management admin permission is not required to select a teacher during a Visit
- The **Visit Teacher** source change is limited to shared School Visit teacher lookup and Individual AF Teacher Interaction completion validation; it does not change Staff Management, Visit payload shape, picker UI, or completed Visit summaries

## Example dialogue

> **Dev:** "When a **PM** deletes a **Visit**, do we also delete the **Actions**?"
> **Domain expert:** "Yes — cascade **soft delete** all child **Actions** in the same transaction. A dangling action with no parent visit makes no sense."

> **Dev:** "Can a **Program Admin** delete a **Visit**?"
> **Domain expert:** "No — **Program Admins** are read-only. Only the **PM** owner and **Admins** can delete."

> **Dev:** "Can a completed **Visit** be deleted?"
> **Domain expert:** "No — completed visits are auditable records. Only `in_progress` visits can be deleted."

## Flagged ambiguities

- "school code" vs "UDISE code": `school.code` is an internal short identifier; `school.udise_code` is the government-issued UDISE. Both identify a school but in different contexts. API routes use UDISE in URLs, passcodes derive from school code.
- "center/centre" in the imported CRUD export means **Centre**, not **School**.
- Centre `name` alone is not an identity; `JNV Adilabad` appears as separate CoE and Nodal centres in the source export.
- The source `program` column maps to **Centre Stream**, not **Program** or **Exam Track**; it should be stored as an array, not a comma-separated string.
- Centre option labels are configurable option data; Centre rows should store stable codes rather than labels.
- "admin" vs "program_admin": These are distinct roles. `admin` has write access; `program_admin` is read-only. The naming is confusing — always use the full term.
- "deleted" for actions vs visits: Actions already support soft delete (`deleted_at` on `lms_pm_school_visit_actions`). Issue #35 extends this to visits (`lms_pm_school_visits`).
- "teacher" in School Visit forms means **Visit Teacher**, not every `user_permission.role = "teacher"` account.
