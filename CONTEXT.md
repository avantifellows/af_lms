# AF LMS

Student enrollment management and PM school-visit tracking for Avanti Fellows — a nonprofit running supplemental education programs in Indian government schools.

## Language

### Enrollment & School

**School**:
A government school enrolled in an Avanti Fellows program, identified by UDISE code.
_Avoid_: Institution, center

**Student**:
A learner enrolled at a school, linked via `group_user` membership.
_Avoid_: Learner, pupil

**Batch**:
A grouping of students within a school for program delivery.
_Avoid_: Cohort, section

**Program**:
An Avanti Fellows delivery model within a school, such as CoE, Nodal, or NVS.
_Avoid_: Course, stream

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

## Example dialogue

> **Dev:** "When a **PM** deletes a **Visit**, do we also delete the **Actions**?"
> **Domain expert:** "Yes — cascade **soft delete** all child **Actions** in the same transaction. A dangling action with no parent visit makes no sense."

> **Dev:** "Can a **Program Admin** delete a **Visit**?"
> **Domain expert:** "No — **Program Admins** are read-only. Only the **PM** owner and **Admins** can delete."

> **Dev:** "Can a completed **Visit** be deleted?"
> **Domain expert:** "No — completed visits are auditable records. Only `in_progress` visits can be deleted."

## Flagged ambiguities

- "school code" vs "UDISE code": `school.code` is an internal short identifier; `school.udise_code` is the government-issued UDISE. Both identify a school but in different contexts. API routes use UDISE in URLs, passcodes derive from school code.
- "admin" vs "program_admin": These are distinct roles. `admin` has write access; `program_admin` is read-only. The naming is confusing — always use the full term.
- "deleted" for actions vs visits: Actions already support soft delete (`deleted_at` on `lms_pm_school_visit_actions`). Issue #35 extends this to visits (`lms_pm_school_visits`).
