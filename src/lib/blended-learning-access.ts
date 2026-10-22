import { query } from "./db";
import { BLENDED_MENTOR_ROLE } from "./constants";
import { getBlendedLearningPermission, getFeatureAccess } from "./permissions";

// The single gate for /blended-learning (server-only). Every Blended Learning
// page and API route calls getBlendedLearningAccess before reading or writing,
// then canBlendedLearning for the action. Student-level scoping
// (canAccessBlendedStudent) arrives with the Mentee list.

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
  // A Blended Learning Mentor sees their own Mentees; a Blended Learning Admin
  // (a blended_admin or an LMS admin) sees every Mentor's.
  kind: "mentor" | "admin";
  role: "blended_mentor" | "blended_admin" | "admin";
  readOnly: boolean;
  actorEmail: string;
  actorUserId: number | null;
  // Mentors only: the `user` id their Mappings point at.
  mentorUserId?: number | null;
};

const MUTATIONS: ReadonlySet<BlendedLearningAction> = new Set(["log", "upload", "manage_draft"]);
const ADMIN_ONLY: ReadonlySet<BlendedLearningAction> = new Set([
  "play_recording",
  "view_flags",
  "view_mentors",
]);

// The person's `user` id: user_permission.user_id, else the `user` row whose
// email matches case-insensitively (as Holistic does).
async function actorUserId(email: string, linkedUserId: number | null | undefined) {
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
  const userId = await actorUserId(email, permission.user_id);
  const base = {
    role,
    readOnly: !feature.canEdit,
    actorEmail: email,
    actorUserId: userId,
  };
  if (role === BLENDED_MENTOR_ROLE) {
    return { kind: "mentor", ...base, mentorUserId: userId };
  }
  return { kind: "admin", ...base };
}

// Read-only users never mutate; recordings, flags and Mentor cards are for
// Blended Learning Admins (including read-only ones).
export function canBlendedLearning(
  access: BlendedLearningAccess | null,
  action: BlendedLearningAction
): boolean {
  if (!access) return false;
  if (MUTATIONS.has(action) && access.readOnly) return false;
  if (ADMIN_ONLY.has(action) && access.kind !== "admin") return false;
  return true;
}
