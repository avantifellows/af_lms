import type { PoolClient } from "pg";

import { query } from "./db";
import { BLENDED_MENTOR_ROLE, CURRENT_ACADEMIC_YEAR } from "./constants";
import { getBlendedLearningPermission, getFeatureAccess } from "./permissions";

// The single gate for /blended-learning (server-only). Every Blended Learning
// page and API route calls getBlendedLearningAccess before reading or writing,
// then canBlendedLearning for the action (both through blended-learning-guard),
// and, before touching one Student, canAccessBlendedStudent to write (or to
// read what only the assigned Mentor reads) or canViewBlendedStudent to read.

export type BlendedLearningAction =
  | "view_list"
  | "view_student"
  | "log"
  | "upload"
  | "manage_draft"
  | "play_recording"
  | "view_flags"
  | "view_mentors"
  | "manage"
  | "record_jee_form";

export type BlendedLearningAccess = {
  // A Blended Learning Mentor sees and logs for their own Mentees; a Blended
  // Learning Admin (a blended_admin or an LMS admin) sees every Mentor's, view
  // only, and (unless read-only) manages Resources and Common Action Items.
  kind: "mentor" | "admin";
  role: "blended_mentor" | "blended_admin" | "admin";
  readOnly: boolean;
  actorEmail: string;
  // Mentors only: the `user` id their Mappings point at.
  mentorUserId?: number | null;
  // Mentors only: the Mentors whose Students they supervise (active
  // current-year Supervisions), ascending. They view those Students and their
  // flags, never write for them: writes stay with the mapped Mentor.
  supervisedMentorUserIds?: number[];
};

// How far a viewer reaches one Student: "full" for a Mentor's own Mentee (and
// for a Blended Learning Admin, whose writes canBlendedLearning limits), or
// "view_only" for a supervised Mentor's Mentee.
export type BlendedStudentScope = "full" | "view_only";

const MUTATIONS: ReadonlySet<BlendedLearningAction> = new Set(["log", "upload", "manage_draft"]);
const ADMIN_ONLY: ReadonlySet<BlendedLearningAction> = new Set(["play_recording", "view_mentors"]);

// A Mentor's `user` id: user_permission.user_id, else the `user` row whose
// email matches case-insensitively (as Holistic does).
async function linkedUserId(email: string, linkedUserId: number | null | undefined) {
  if (linkedUserId != null) return linkedUserId;
  const rows = await query<{ id: number | string }>(
    `SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1`,
    [email]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

// The `user` id a user_permission row (`alias`) points at, resolved as
// getBlendedLearningAccess resolves a Mentor: user_permission.user_id, else
// the lowest-id `user` row whose email matches case-insensitively.
export function permissionUserIdSql(alias: string): string {
  return `COALESCE(${alias}.user_id,
           (SELECT account.id FROM "user" account
            WHERE LOWER(account.email) = LOWER(${alias}.email) ORDER BY account.id LIMIT 1))`;
}

// The `user` id (`userIdSql`) still holds a live (not revoked) permission with
// the role bound to `roleParam` (BLENDED_MENTOR_ROLE): a Mentor who has left or
// been revoked is no longer one, whatever Mappings or Supervisions remain. The
// Manage page's Team leads use it too, to flag a Supervision this makes inert.
export function liveBlendedMentorSql(userIdSql: string, roleParam: string): string {
  return `EXISTS (SELECT 1 FROM user_permission live_permission
            WHERE live_permission.role = ${roleParam} AND live_permission.revoked_at IS NULL
              AND ${permissionUserIdSql("live_permission")} = ${userIdSql})`;
}

// The Mentors a supervisor supervises this academic year, ascending. A
// reportee who is no longer a live Blended Learning Mentor drops out, so the
// team lead stops seeing their Students even before the Supervision is ended.
async function supervisedMentorIds(supervisorUserId: number | null): Promise<number[]> {
  if (supervisorUserId == null) return [];
  const rows = await query<{ mentor_user_id: number | string }>(
    `SELECT DISTINCT supervision.mentor_user_id
     FROM blended_learning_mentor_supervisions supervision
     WHERE supervision.supervisor_user_id = $1 AND ${activeBlendedSupervisionSql("supervision", "$2")}
       AND ${liveBlendedMentorSql("supervision.mentor_user_id", "$3")}
     ORDER BY supervision.mentor_user_id`,
    [supervisorUserId, CURRENT_ACADEMIC_YEAR, BLENDED_MENTOR_ROLE]
  );
  return rows.map((row) => Number(row.mentor_user_id)).filter((id) => id !== supervisorUserId);
}

export async function getBlendedLearningAccess(
  email: string | null | undefined
): Promise<BlendedLearningAccess | null> {
  if (!email) return null;
  const permission = await getBlendedLearningPermission(email);
  if (!permission) return null;
  const feature = getFeatureAccess(permission, "blended_learning");
  if (!feature.canView) return null;

  const role = permission.role as BlendedLearningAccess["role"];
  const base = { role, readOnly: !feature.canEdit, actorEmail: email };
  if (role === BLENDED_MENTOR_ROLE) {
    const mentorUserId = await linkedUserId(email, permission.user_id);
    const supervisedMentorUserIds = await supervisedMentorIds(mentorUserId);
    return { kind: "mentor", ...base, mentorUserId, supervisedMentorUserIds };
  }
  return { kind: "admin", ...base };
}

// Only a Mentor who is not read-only mutates Mentee records (logs, uploads,
// manages drafts), and only their own Mentees (canAccessBlendedStudent,
// lockMappingInScope); a Blended Learning Admin views them. The Manage page
// (Resources and Common Action Items) is the one thing an admin edits, and
// only when not read-only; Mentors never. Recordings and every Mentor's cards
// (view_mentors) are for Blended Learning Admins (including read-only ones); a
// team lead gets only their own and their reportees' cards (isTeamLead,
// listMentorCards). Everyone sees flags: an
// admin every flag, a Mentor only those on their own Students
// (blended-learning-flags). The JEE form is recorded by the Mentor or a
// Blended Learning Admin, never by a read-only account.
export function canBlendedLearning(
  access: BlendedLearningAccess | null,
  action: BlendedLearningAction
): boolean {
  if (!access) return false;
  if (MUTATIONS.has(action)) return access.kind === "mentor" && !access.readOnly;
  if (action === "manage") return access.kind === "admin" && !access.readOnly;
  if (action === "record_jee_form") return !access.readOnly;
  if (ADMIN_ONLY.has(action)) return access.kind === "admin";
  return true;
}

// The Student (`studentIdSql`, the SQL for a `student.id`) is not marked a
// dropout (`student.status = 'dropout'`). A NULL or any other status passes.
export function notBlendedDropoutSql(studentIdSql: string): string {
  return `NOT EXISTS (SELECT 1 FROM student dropout_student
            WHERE dropout_student.id = ${studentIdSql} AND dropout_student.status = 'dropout')`;
}

// Mapping rows as stored, not yet ended, for CURRENT_ACADEMIC_YEAR: running
// (`ended_at IS NULL`) or given a future end (still in force until then),
// whatever the Student's status and whether or not their period has started.
// A Student mid-handover can have two such rows (the old one ending as the
// new one starts). Only operator data loads (the links import) use it;
// everything Mentors and admins see goes through activeBlendedMappingSql.
export function currentBlendedMappingRowSql(alias: string, yearParam: string): string {
  return `${alias}.academic_year = ${yearParam} AND (${alias}.ended_at IS NULL OR ${alias}.ended_at > (now() AT TIME ZONE 'UTC'))`;
}

// The Mapping or Supervision row's (`alias`) period [started_at, ended_at)
// contains now. Both are UTC timestamps without time zone. The import sheet
// may date a row in the future, and a reassignment ends the old row at the
// new row's started_at, so a row can be not-yet-started or ended-in-the-future:
// the old Mentor keeps the Student until the handover, the new one gets them
// from then on. A zero-length row (ended_at = started_at) contains nothing.
// db-service's exclusion constraint keeps one Student's (or one supervision
// pair's) periods in a year from overlapping, so at most one row contains any
// instant. Slot and write guards (the partial unique index on
// `ended_at IS NULL`, the team-lead insert and End, the Manage list) leave
// this out: a future row still holds the slot and can still be ended.
function containsNowBlendedRowSql(alias: string): string {
  return `${alias}.started_at <= (now() AT TIME ZONE 'UTC') AND (${alias}.ended_at IS NULL OR ${alias}.ended_at > (now() AT TIME ZONE 'UTC'))`;
}

// The Mapping source: active current-year Mappings (period contains now) of
// Students not marked a dropout. A dropout leaves Blended Learning everywhere
// (list, Mentor cards, Flags, Common Action Items, their page) while the
// Mapping row stays, so they come back if their status changes back.
// `yearParam` is the placeholder bound to CURRENT_ACADEMIC_YEAR.
export function activeBlendedMappingSql(alias: string, yearParam: string): string {
  return `${alias}.academic_year = ${yearParam} AND ${containsNowBlendedRowSql(alias)} AND ${notBlendedDropoutSql(`${alias}.student_id`)}`;
}

// Active Supervisions (period contains now) for CURRENT_ACADEMIC_YEAR. A
// Supervision has the Mapping's lifecycle columns but no Student, so the
// dropout filter applies to the supervised Mentor's Mappings instead.
function activeBlendedSupervisionSql(alias: string, yearParam: string): string {
  return `${alias}.academic_year = ${yearParam} AND ${containsNowBlendedRowSql(alias)}`;
}

// The Mentors whose Students the viewer sees: a Mentor's own and supervised
// Mentors' ids, or null for a Blended Learning Admin (every Mentor). A Mentor
// with no `user` id sees no one.
export function viewableMentorUserIds(access: BlendedLearningAccess): number[] | null {
  if (access.kind === "admin") return null;
  if (access.mentorUserId == null) return [];
  return [access.mentorUserId, ...(access.supervisedMentorUserIds ?? [])];
}

// A team lead: a Mentor who supervises at least one other Mentor. They land
// on cards for themselves and their reportees (listMentorCards) instead of
// their own list, which moves to a My Students tab.
export function isTeamLead(access: BlendedLearningAccess): boolean {
  return access.kind === "mentor" && access.mentorUserId != null && (access.supervisedMentorUserIds?.length ?? 0) > 0;
}

// The supervised Mentor the viewer asked for, or null when `mentorUserId` is
// missing or not one they supervise.
export function supervisedMentor(access: BlendedLearningAccess, mentorUserId: number | null): number | null {
  if (access.kind !== "mentor" || mentorUserId == null) return null;
  return access.supervisedMentorUserIds?.includes(mentorUserId) ? mentorUserId : null;
}

function scopeForMapping(access: BlendedLearningAccess, mappedMentorUserId: number): BlendedStudentScope | null {
  if (access.kind === "admin" || mappedMentorUserId === access.mentorUserId) return "full";
  return supervisedMentor(access, mappedMentorUserId) === null ? null : "view_only";
}

// A Mentor's display name from the `user` row `alias` (joined on the
// Mapping's mentor_user_id, `idSql`): full name, else email, else "Mentor <id>".
export function mentorNameSql(alias: string, idSql: string): string {
  return `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)), ''), ${alias}.email, CONCAT('Mentor ', ${idSql}))`;
}

// A Student is in scope with an active current-year Mapping and not marked a
// dropout: for a Mentor, to them ("full") or to a Mentor they supervise
// ("view_only"); for an admin, to anyone ("full"). Null when out of scope.
export async function blendedStudentScope(
  access: BlendedLearningAccess | null,
  studentId: number
): Promise<BlendedStudentScope | null> {
  if (!access || !Number.isSafeInteger(studentId) || studentId <= 0) return null;
  if (access.kind === "mentor" && access.mentorUserId == null) return null;

  const rows = await query<{ mentor_user_id: number | string }>(
    `SELECT mapping.mentor_user_id
     FROM blended_learning_mentor_mentee_mappings mapping
     WHERE mapping.student_id = $1 AND ${activeBlendedMappingSql("mapping", "$2")}
     LIMIT 1`,
    [studentId, CURRENT_ACADEMIC_YEAR]
  );
  const mapping = rows[0];
  return mapping ? scopeForMapping(access, Number(mapping.mentor_user_id)) : null;
}

// Full scope: a Mentor's own Mentee, or any mapped Student for an admin. Every
// write checks this (or lockMappingInScope), never canViewBlendedStudent, so a
// supervisor cannot write for a supervised Mentor's Mentee.
export async function canAccessBlendedStudent(
  access: BlendedLearningAccess | null,
  studentId: number
): Promise<boolean> {
  return (await blendedStudentScope(access, studentId)) === "full";
}

// Read scope: full scope, or a supervised Mentor's Mentee (view only).
export async function canViewBlendedStudent(
  access: BlendedLearningAccess | null,
  studentId: number
): Promise<boolean> {
  return (await blendedStudentScope(access, studentId)) !== null;
}

export type MappingSnapshot = {
  mentor_user_id: number | string;
  program_id: number | string;
  academic_year: string;
};

// Inside a write's transaction: the Student's active current-year Mapping,
// re-read and locked FOR SHARE, or null when there is none or (for a Mentor)
// it is to someone else, a Mentor they supervise included.
export async function lockMappingInScope(
  client: PoolClient,
  access: BlendedLearningAccess,
  studentId: number
): Promise<MappingSnapshot | null> {
  const result = await client.query<MappingSnapshot>(
    `SELECT mapping.mentor_user_id, mapping.program_id, mapping.academic_year
     FROM blended_learning_mentor_mentee_mappings mapping
     WHERE mapping.student_id = $1 AND ${activeBlendedMappingSql("mapping", "$2")}
     LIMIT 1
     FOR SHARE`,
    [studentId, CURRENT_ACADEMIC_YEAR]
  );
  const mapping = result.rows[0];
  if (!mapping) return null;
  if (access.kind === "mentor" && Number(mapping.mentor_user_id) !== access.mentorUserId) return null;
  return mapping;
}
