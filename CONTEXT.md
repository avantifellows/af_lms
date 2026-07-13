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

### Academic Mentorship

**Academic Mentorship**:
The LMS domain for assigning teacher mentors to selected students for a school and academic year.
_Avoid_: Mentorship tab, holistic mentorship, AI report generation

**Academic Mentor**:
A completed Staff Management Teacher who is eligible to be assigned responsibility for one or more Mentees at their school.
_Avoid_: Pending teacher, owner, counsellor

**Mentee**:
A Student assigned to an Academic Mentor for the academic year.
_Avoid_: Learner, advisee

**Academic Mentor-Mentee Mapping**:
A historical assignment record connecting one Academic Mentor to one Mentee for one school and academic year.
_Avoid_: Pairing, link row, live assignment only

**Academic Mentorship Mentor-Mentee Mapping Table**:
The database table `academic_mentorship_mentor_mentee_mappings`, storing Academic Mentor-Mentee Mapping history.
_Avoid_: `acad_mentorship_teacher_feedback`, report-generation tables

**Mentorship Tab**:
The School page umbrella surface for school mentorship workflows.
_Avoid_: Academic Mentorship tab

### Holistic Mentorship

**Holistic Mentorship**:
The LMS domain for phase-based, non-academic mentoring in which assigned staff prepare from Student Context and Phase Guidance, conduct an offline conversation, and submit Post-Session Notes.
_Avoid_: Academic Mentorship, AI Mentorship, generic Mentorship

**Holistic Mentor**:
A staff User assigned responsibility for one or more Holistic Mentees.
_Avoid_: Academic Mentor, counsellor

**Holistic Mentorship Admin**:
A staff User assigned the dedicated Holistic Mentorship Admin LMS role. This is the User's single LMS role; the role's feature permissions may include Holistic Mentorship and other LMS surfaces.
_Avoid_: Mentor Admin, Centre designation, additive feature-only grant

**Holistic Phase Plan**:
The academic-year version of one Program's full ordered Holistic Phase sequence across Grades 11 and 12.
_Avoid_: Evergreen phase configuration, separate mentorship cycle

**Holistic Phase**:
A stable item in a Holistic Phase Plan, assigned to Grade 11 or Grade 12, given a required short title, and placed in the Program's full phase sequence. Its displayed `Phase N` number is derived from that order rather than stored as identity.
_Avoid_: Session, fixed phase number

**Holistic Mentee**:
A Student assigned to a Holistic Mentor.
_Avoid_: Academic Mentee, learner, advisee

**Holistic Mentor-Mentee Mapping**:
An assignment connecting one Holistic Mentor to one Holistic Mentee without implying an Academic Mentor-Mentee Mapping.
_Avoid_: Academic Mentor-Mentee Mapping, shared mentorship mapping

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
- **Academic Mentorship** uses the `academic_mentorship` permission key and is part of the same mentorship product language as AI Mentorship Guide, not a separate generic "mentorship" feature
- The School page **Mentorship Tab** remains labelled `Mentorship`; **Academic Mentorship** is one workflow inside that tab
- An **Academic Mentor** must be a completed Staff Management Teacher: active LMS permission with teacher role, a real AF `teacher` record, a non-exited Staff Management state, and effective access to the selected School
- The Academic Mentor dropdown includes eligible Academic Mentors even if they already have active Mentees
- Academic Mentorship mentor selectors are searchable by mentor name and email
- Academic Mentorship uses a dedicated Program allowlist, separate from the existing CoE/Nodal-only gate used by other LMS features
- Academic Mentorship allowed Program gating uses a code constant in v1
- Academic Mentorship can proceed with the approved Program gating list set to `[*]` (all Programs) while exact Program ids are confirmed later
- Exact Academic Mentorship allowed Program ids are not a blocker for the rest of requirements grilling; confirm before implementation and update the code constant when needed
- Academic Mentor and Mentee eligibility requires the same selected School and an allowed Academic Mentorship Program; Mentor and Mentee do not need to be in the same Program
- **Academic Mentor-Mentee Mappings** store the Academic Mentor as the mentor's `user.id`; `teacher` is joined only for completed Staff Management eligibility and display metadata
- An **Academic Mentor** can have many **Mentees** in an academic year
- A **Mentee** has at most one active **Academic Mentor-Mentee Mapping** per school and academic year
- A **Mentee** can have multiple historical **Academic Mentor-Mentee Mappings** in one academic year when they are removed from mentorship and later selected again, or when they are reassigned from one Academic Mentor to another
- **Holistic Mentorship** and **Academic Mentorship** are independent domains; assignment in one does not imply assignment in the other
- **Holistic Mentorship** uses the canonical LMS Student, User, School, and Program identities without reusing Academic Mentorship-owned records
- The v1 Holistic Mentorship launch allowlist contains canonical Main DB Program ID `1` (`JNV CoE`) only and covers every School in that Program; it does not hard-code the current School IDs or count
- Each Program has one **Holistic Phase Plan** per academic year; when creating a new Plan, an Admin can start blank or copy the prior Plan's Grade, title, order, Guidance, and Questions into new Phase records that are all Locked with none Active, while student work and Phase state are never copied and the prior Plan stays read-only
- Each **Holistic Phase** keeps a stable internal identity and required short title; LMS derives its displayed `Phase N` number from its position in the Plan's full ordered sequence
- Opening a **Holistic Phase** makes it available for the selected Program, academic year, and Grade; the current Phase is both Open and Active, earlier Phases remain Open but are no longer Active, and future Phases are Locked
- A Program, academic year, and Grade has no Active Phase before any Phase is Open; once any Phase is Open, exactly one Open Phase is Active, opening a Locked Phase makes it Active, and an Admin may move Active to any other Open Phase
- A **Holistic Mentorship Admin** may open Phases out of sequence and change which Open Phase is Active at any time; LMS does not enforce sequential Phase transitions
- Changing which **Holistic Phase** is Active never closes another Phase; every already Open Phase stays Open
- A **Holistic Mentorship Admin** may move an Open Phase back to Locked only while no Mentor has saved a draft or submitted Post-Session Notes for that Phase; after student work exists, the Phase may lose Active status but must stay Open
- A **Holistic Mentorship Admin** may permanently delete only a Locked Phase that has never had Mentor work; once a Phase has been opened or used it and its history are retained, and no separate per-Phase Archive action exists in v1
- A **Holistic Mentorship Admin** may reorder or insert Phases only among Locked future Phases that have never had Mentor work; once a Phase has been opened or used, its position in the Plan is fixed, although Admins may still open or activate Phases out of sequence
- A **Holistic Phase** does not store an Admin-controlled first-Phase flag; LMS derives the first Phase as the earliest ordered Phase assigned to each Grade, while per-Student context source and fallback rules are decided separately
- A **Holistic Phase** has one Open/Active state per Program, academic year, and Grade that applies to every School in that Program; v1 has no School-specific Phase state
- A **Holistic Phase** cannot be opened until it has a Grade, required short title, valid Phase Guidance, and at least one valid Post-Session Question; the Guidance and Notes lifecycles define their detailed validation
- In v1, the first persisted Post-Session Notes data for any Mentee marks a **Holistic Phase** as started and freezes its Grade, title, sequence position, Phase Guidance, and Post-Session Questions; Open and Active state changes remain available to Admins
- V1 Phase opening and state changes are immediate manual Admin actions with confirmation and actor/time audit; scheduled Phase opening is out of scope
- Only an active Staff Management Teacher assigned to a launch School in Program 1 is eligible to be a **Holistic Mentor** in v1
- Holistic Mentor eligibility and Mapping access are scoped independently to each launch School where the Teacher has an active Teacher seat; a Teacher with multiple eligible seats can use each School's mapping roster, including before they have any assigned Mentees
- An eligible Teacher retains their normal access outside Holistic Mentorship; inside Holistic Mentorship they can see the School's mapping roster but can read full Holistic data only for their assigned Holistic Mentees
- An eligible Teacher can assign an unmapped Student to themselves, reassign another Mentor's Mentee to themselves, and remove their own Mentee assignment from the Mentorship Tab
- A Holistic Mentee has at most one active **Holistic Mentor-Mentee Mapping** at a time
- Only a Holistic Mentee's currently assigned **Holistic Mentor** can draft and submit that Mentee's Post-Session Notes
- A Holistic Mentee's currently assigned **Holistic Mentor** may read prior submitted Post-Session Notes for that Mentee but may edit only Notes they authored; a former Mentor loses access after reassignment, Admins remain read-only, and no reopen workflow is required
- Program Managers, Program Admins, and passcode users have no Holistic Mentorship access in v1
- **Holistic Mentorship Admin** is a dedicated LMS role, not an additive capability combined with another LMS role or a Centre designation
- An **Admin** automatically receives the same Holistic Mentorship feature access without becoming a **Holistic Mentorship Admin**
- In v1, the **Holistic Mentorship Admin** role grants access only to Holistic Mentorship; access to other LMS features is deferred
- A **Holistic Mentorship Admin** can view the School and staff context needed for Holistic Mentorship across all launch Schools, but can edit only Holistic Mentorship records
- A **Holistic Mentorship Admin** can view all eligible Students across the launch Program, including Students who are not yet mapped to a Holistic Mentor
- A **Holistic Mentorship Admin** can read every Holistic Mentee's Student Context and Post-Session Notes across the launch Program
- **Holistic Mentorship Admins** and **Admins** can view Mapping status but cannot assign, reassign, or remove Holistic Mentees in v1
- The db-service table for **Academic Mentor-Mentee Mappings** is `academic_mentorship_mentor_mentee_mappings`
- The **Academic Mentorship Mentor-Mentee Mapping Table** stores `id`, `school_id`, nullable `program_id`, `academic_year`, `mentor_user_id`, `student_id`, `assigned_at`, `assigned_by_user_id`, `ended_at`, `ended_by_user_id`, optional `end_reason`, and normal timestamps
- `assigned_by_user_id` and `ended_by_user_id` on the **Academic Mentorship Mentor-Mentee Mapping Table** reference `user.id`, not `user_permission.id`, because mappings audit the person taking the action rather than the person's mutable permission row
- `program_id` on the **Academic Mentorship Mentor-Mentee Mapping Table** is nullable in v1 and stores the Mentee's roster Program when available
- New **Academic Mentor-Mentee Mappings** auto-fill nullable `program_id` from the selected Mentee's current roster program when available; otherwise it stays null
- The **Academic Mentorship Mentor-Mentee Mapping Table** enforces one active mapping per Mentee per School and academic year with a partial unique index on `(school_id, academic_year, student_id)` where `ended_at IS NULL`
- **Academic Mentor-Mentee Mappings** preserve history when removed or reassigned
- Staff Management hard delete blocks Teachers with any Academic Mentor-Mentee Mapping history
- Staff Management exit/revoke blocks Teachers only when they have active Mentees; historical mappings can remain after exit
- Staff Management shows a warning/blocking message when Teacher delete or exit/revoke is blocked by Academic Mentor-Mentee Mappings
- Staff Management mentorship block warnings include active Mentee count and a link to `/admin/academic-mentorship` for the relevant School and academic year when available
- Manual reassignment is a dedicated Reassign action on an existing active **Academic Mentor-Mentee Mapping**
- The Add Mapping form only shows unassigned **Mentees**; it does not implicitly reassign already-mapped Students
- Academic Mentorship student selectors are searchable by Student name and external `student_id`
- The Academic Mentorship admin table defaults to active mappings only, grouped by Academic Mentor
- The Academic Mentorship admin table shows a Mentee count in each Academic Mentor group header
- Academic Mentorship mapping rows show Mentee name, grade, external `student_id`, assigned date, and status; when Show history is enabled, rows also show ended date
- Academic Mentorship mapping rows do not show `program_id`, `assigned_by_user_id`, or `ended_by_user_id` by default in v1; those fields stay stored for audit and future use
- Active Academic Mentorship mapping rows show Reassign and Remove actions for users with edit access; historical mapping rows show no actions
- Removing an active Academic Mentor-Mentee Mapping requires confirmation that the Student will no longer have an active Academic Mentor
- Reassigning an active Academic Mentor-Mentee Mapping requires confirmation that the old mapping will be ended and a new mapping will be created
- If a manual add fails because the Student was already mapped concurrently, the UI shows "Student already has a mentor mapped" and refreshes the table
- After manual add, remove, or reassign succeeds, the UI shows a small success message and refreshes the mapping table automatically
- Reassignment excludes the current active Academic Mentor from the replacement Academic Mentor options
- The Academic Mentorship admin table can include historical mappings via a Show history toggle that extends the same view
- Academic Mentorship grouped overview only shows Academic Mentors who have mappings in the selected view and academic year
- The `/admin/academic-mentorship` page is accessible only to Admins and Program Admins; Teachers use only the School page Mentorship Tab
- Admins and Program Admins see a read-only overview on the School page Mentorship Tab, with management actions kept on `/admin/academic-mentorship`
- Admins and Program Admins see a Manage mappings link from the School page Mentorship Tab to `/admin/academic-mentorship`; read-only Program Admins land there in view-only mode
- The Manage mappings link preselects the current School and current academic year on `/admin/academic-mentorship` via query params
- The School page Mentorship Tab shows the current academic year only, with no academic year picker
- Passcode users do not see the School page Mentorship Tab; Academic Mentorship is for Google-login staff governed by Staff Management permissions
- Program Managers do not get an admin page link for Academic Mentorship; they use only the School page Mentorship Tab read-only view
- Academic Mentorship APIs live under `/api/academic-mentorship/*`, with route handlers checking role, School scope, Program allowlist, and requested action
- Academic Mentorship route handlers use a shared server-side access helper for role, School scope, Program allowlist, `read_only`, and requested action checks
- The `/admin/academic-mentorship` School picker auto-selects when the user has exactly one accessible School; otherwise it starts empty and asks the user to pick a School
- The `/admin/academic-mentorship` academic year options reuse the existing LMS current-academic-year source and show current plus two prior academic years
- The `/admin/academic-mentorship` page allows manual add, remove, and reassign only for the current academic year; assignment and end timestamps use the actual action time
- Academic Mentorship CSV import allows only the current plus two prior academic years shown in the picker; unsupported years are rejected server-side even if a user crafts a direct API request
- The `/admin/academic-mentorship` selected School and academic year are reflected in URL query params such as `school_code` and `academic_year`
- Teachers see only their current active Mentees on the School page Mentorship Tab as a flat list sorted by grade, then name
- Teacher empty state for the School page Mentorship Tab is "No mentees assigned for this academic year."
- Program Managers see active Academic Mentor-Mentee Mappings only on the School page Mentorship Tab in v1; history stays on the admin management page
- Ending an **Academic Mentor-Mentee Mapping** does not ask for a reason in v1; `end_reason` stays optional in the table for later use
- In v1, **Academic Mentor-Mentee Mapping** assignment and end timestamps are system-recorded when the action happens; admins do not backdate assignment or removal dates
- Academic Mentorship CSV upload identifies mentors by email and mentees by external `student.student_id`; stored mappings still use internal Main DB ids
- The Academic Mentorship admin page provides a CSV template download with `mentor_email,student_id` headers
- Academic Mentorship CSV upload validates `mentor_email` as an eligible completed Staff Management Teacher at the selected School
- Academic Mentorship CSV upload validates `student_id` as an active roster Student at the selected School and academic year
- Academic Mentorship CSV upload applies to the page-selected academic year, which defaults to the current academic year; CSV files do not include an academic year column
- Academic Mentorship CSV uploads for prior academic years are inserted as historical mappings by setting `ended_at` and `ended_by_user_id`, so Staff Management does not treat them as active Mentees
- Academic Mentorship CSV upload requires `mentor_email` and `student_id` headers but allows extra columns and ignores them
- Academic Mentorship CSV upload shows a normal file-level error, not an error CSV, when the file is empty or required headers are missing
- Academic Mentorship CSV upload trims `mentor_email` and `student_id`; mentor email lookup is case-insensitive, while `student_id` matches trimmed exact text
- Academic Mentorship CSV upload ignores completely blank rows; rows with one required field present and another required field blank produce row-level validation errors
- Academic Mentorship CSV upload is capped at 2,000 data rows in v1
- Academic Mentorship CSV upload fails the whole file when a row targets a student who already has an active Academic Mentor-Mentee Mapping; the validation error must include the CSV row number and say the student already has a mentor mapped
- Academic Mentorship CSV upload fails the whole file when the same `student_id` appears more than once in the CSV; duplicate rows should be reported as duplicate student rows in the file
- Academic Mentorship CSV upload should let admins download an error CSV containing only rejected rows and an error reason column
- Academic Mentorship CSV error downloads include the original uploaded columns plus an `error_reason` column
- Academic Mentorship CSV validation row numbers match spreadsheet row numbers: the header is row 1, and the first data row is row 2
- Successful Academic Mentorship CSV upload shows a success count, and the mapping table refreshes automatically
- Academic Mentorship v1 does not include a general "Export mappings CSV" action
- Academic Mentorship mentee selection uses the same active-student rules as the School page roster for the selected School and academic year, excluding dropouts and students who already have an active mapping
- Academic Mentorship access in v1 is controlled by role, school scope, `read_only`, and the Academic Mentorship Program allowlist
- Academic Mentorship data model supports all programs, including NVS and PMU schools
- `/admin` does not show an Academic Mentorship card; Academic Mentorship management entry comes from the School page **Mentorship Tab** Manage mappings link
- `read_only` downgrades Academic Mentorship management to view-only
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
- "mentorship" as a UI label vs permission key: the School page tab stays **Mentorship Tab** as an umbrella, while the internal feature key and domain term are **Academic Mentorship** / `academic_mentorship`.
- "teacher" in School Visit forms means **Visit Teacher**, not every `user_permission.role = "teacher"` account.
