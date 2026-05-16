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

**UDISE Code**:
A unique government-issued identifier for a school.
_Avoid_: School ID, school code (internally `school.code` is a separate field)

**Passcode**:
An 8-digit code granting single-school access without Google OAuth. Format: `{schoolCode}XXX`.
_Avoid_: PIN, access code

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

**Soft Delete**:
Setting `deleted_at` timestamp instead of removing the row. Used for actions and (issue #35) visits.
_Avoid_: Archive, deactivate

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
