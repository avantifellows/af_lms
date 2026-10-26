import type { PoolClient } from "pg";

import { query } from "./db";
import { BLENDED_MENTOR_ROLE, CURRENT_ACADEMIC_YEAR } from "./constants";
import { getBlendedLearningPermission, getFeatureAccess } from "./permissions";

// The single gate for /blended-learning (server-only). Every Blended Learning
// page and API route calls getBlendedLearningAccess before reading or writing,
// then canBlendedLearning for the action (both through blended-learning-guard),
// and canAccessBlendedStudent before touching one Student.

export type BlendedLearningAction =
  | "view_list"
  | "view_student"
  | "log"
  | "upload"
  | "manage_draft"
  | "play_recording"
  | "view_flags"
  | "view_mentors";

export type BlendedLearningAccess = {
  // A Blended Learning Mentor sees and logs for their own Mentees; a Blended
  // Learning Admin (a blended_admin or an LMS admin) sees every Mentor's, view
  // only.
  kind: "mentor" | "admin";
  role: "blended_mentor" | "blended_admin" | "admin";
  readOnly: boolean;
  actorEmail: string;
  // Mentors only: the `user` id their Mappings point at.
  mentorUserId?: number | null;
};

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
    return { kind: "mentor", ...base, mentorUserId: await linkedUserId(email, permission.user_id) };
  }
  return { kind: "admin", ...base };
}

// Only a Mentor who is not read-only mutates (logs, uploads, manages drafts);
// every Blended Learning Admin is view only. Recordings and Mentor cards are
// for Blended Learning Admins (including read-only ones). Everyone sees flags:
// an admin every flag, a Mentor only those on their own Students
// (blended-learning-flags).
export function canBlendedLearning(
  access: BlendedLearningAccess | null,
  action: BlendedLearningAction
): boolean {
  if (!access) return false;
  if (MUTATIONS.has(action)) return access.kind === "mentor" && !access.readOnly;
  if (ADMIN_ONLY.has(action)) return access.kind === "admin";
  return true;
}

// The Mapping source: active Mappings (`ended_at IS NULL`) for
// CURRENT_ACADEMIC_YEAR. `yearParam` is the placeholder bound to it.
export function activeBlendedMappingSql(alias: string, yearParam: string): string {
  return `${alias}.academic_year = ${yearParam} AND ${alias}.ended_at IS NULL`;
}

// A Student is in scope with an active current-year Mapping; for a Mentor
// that Mapping must be to them.
export async function canAccessBlendedStudent(
  access: BlendedLearningAccess | null,
  studentId: number
): Promise<boolean> {
  if (!access || !Number.isSafeInteger(studentId) || studentId <= 0) return false;
  if (access.kind === "mentor" && access.mentorUserId == null) return false;

  const rows = await query<{ mentor_user_id: number | string }>(
    `SELECT mapping.mentor_user_id
     FROM blended_learning_mentor_mentee_mappings mapping
     WHERE mapping.student_id = $1 AND ${activeBlendedMappingSql("mapping", "$2")}
     LIMIT 1`,
    [studentId, CURRENT_ACADEMIC_YEAR]
  );
  const mapping = rows[0];
  if (!mapping) return false;
  return access.kind === "admin" || Number(mapping.mentor_user_id) === access.mentorUserId;
}

export type MappingSnapshot = {
  mentor_user_id: number | string;
  program_id: number | string;
  academic_year: string;
};

// Inside a write's transaction: the Student's active current-year Mapping,
// re-read and locked FOR SHARE, or null when there is none or (for a Mentor)
// it is to someone else.
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
