import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "./constants";
import { query } from "./db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getResolvedPermission,
  type UserPermission,
} from "./permissions";
import { PM_SEAT_ROLES } from "./staff-shared";

export type HolisticMentorshipAction =
  | "roster_view"
  | "mapping_mutation"
  | "mapped_student_read"
  | "notes_draft"
  | "notes_submit"
  | "notes_edit"
  | "program_read"
  | "phase_configure"
  | "profile_regenerate"
  | "privacy_delete";

export type HolisticMentorshipSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

export type HolisticMentorshipAccessResult =
  | {
      ok: true;
      email: string;
      permission: UserPermission;
      canEdit: boolean;
      actorUserId?: number;
      school?: HolisticMentorshipSchool;
    }
  | {
      ok: false;
      status: 401 | 403 | 404;
      error: "Unauthorized" | "Forbidden" | "School not found" | "Not found";
    };

export interface HolisticMentorshipSchool {
  id: number;
  code: string;
  name: string;
  region: string | null;
}

interface HolisticMentorshipSchoolRow extends Omit<HolisticMentorshipSchool, "id"> {
  id: number | string;
}

const PROGRAM_ACTIONS = new Set<HolisticMentorshipAction>([
  "program_read",
  "mapped_student_read",
  "phase_configure",
  "profile_regenerate",
]);
const TEACHER_ACTIONS = new Set<HolisticMentorshipAction>([
  "roster_view",
  "mapping_mutation",
  "mapped_student_read",
  "notes_draft",
  "notes_submit",
  "notes_edit",
]);
const MAPPING_REQUIRED_ACTIONS = new Set<HolisticMentorshipAction>([
  "mapped_student_read",
  "notes_draft",
  "notes_submit",
  "notes_edit",
]);
const READ_ONLY_ACTIONS = new Set<HolisticMentorshipAction>([
  "program_read",
  "mapped_student_read",
  "roster_view",
]);

function denied(
  status: 401 | 403 | 404,
  error: "Unauthorized" | "Forbidden" | "School not found" | "Not found"
): HolisticMentorshipAccessResult {
  return { ok: false, status, error };
}

async function findProgramSchool(
  schoolCode: string
): Promise<HolisticMentorshipSchool | null> {
  const rows = await query<HolisticMentorshipSchoolRow>(
    `SELECT id, code, name, region
     FROM school
     WHERE code = $1
       AND $2 = ANY(COALESCE(program_ids, '{}'))
     LIMIT 1`,
    [schoolCode, PROGRAM_IDS.COE]
  );
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

async function findEligibleTeacherUserId(
  email: string,
  schoolId: number
): Promise<number | null> {
  const rows = await query<{ user_id: number | string }>(
    `SELECT DISTINCT u.id AS user_id
     FROM teacher t
     JOIN "user" u ON u.id = t.user_id
     JOIN user_permission up
       ON up.revoked_at IS NULL
      AND (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
     JOIN centre_positions cp
       ON cp.user_id = u.id
      AND cp.deleted_at IS NULL
      AND NOT (cp.role = ANY($4::text[]))
     JOIN centres c
       ON c.id = cp.centre_id
      AND c.is_active IS TRUE
     WHERE LOWER(up.email) = LOWER($1)
       AND c.school_id = $2
       AND c.program_id = $3
       AND t.is_af_teacher = true
       AND t.exit_date IS NULL
     LIMIT 1`,
    [email, schoolId, PROGRAM_IDS.COE, [...PM_SEAT_ROLES]]
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

async function ownsActiveMapping(params: {
  actorUserId: number;
  schoolId: number;
  studentId: number;
  academicYear: string;
}): Promise<boolean> {
  const rows = await query<{ id: number | string }>(
    `SELECT id
     FROM holistic_mentorship_mentor_mentee_mappings
     WHERE mentor_user_id = $1
       AND school_id = $2
       AND student_id = $3
       AND program_id = $4
       AND academic_year = $5
       AND ended_at IS NULL
     LIMIT 1`,
    [
      params.actorUserId,
      params.schoolId,
      params.studentId,
      PROGRAM_IDS.COE,
      params.academicYear,
    ]
  );
  return rows.length > 0;
}

function allowedActor(permission: UserPermission, action: HolisticMentorshipAction) {
  const programWide = permission.role === "admin" || permission.role === "holistic_mentorship_admin";
  return {
    teacher: permission.role === "teacher" && TEACHER_ACTIONS.has(action),
    program: (action === "privacy_delete" && permission.role === "admin") ||
      (programWide && PROGRAM_ACTIONS.has(action)),
  };
}

async function resolveSchool(
  permission: UserPermission,
  schoolCode?: string
): Promise<HolisticMentorshipSchool | HolisticMentorshipAccessResult | undefined> {
  if (!schoolCode) return undefined;
  const school = await findProgramSchool(schoolCode);
  if (!school) return denied(404, "School not found");
  return canAccessSchoolSync(permission, school.code, school.region ?? undefined)
    ? school
    : denied(403, "Forbidden");
}

async function teacherAccess(params: {
  email: string;
  permission: UserPermission;
  canEdit: boolean;
  action: HolisticMentorshipAction;
  school?: HolisticMentorshipSchool;
  studentId?: number;
  academicYear?: string;
}): Promise<HolisticMentorshipAccessResult> {
  if (!params.school) return denied(403, "Forbidden");
  const actorUserId = await findEligibleTeacherUserId(params.email, params.school.id);
  if (actorUserId === null) return denied(403, "Forbidden");
  if (MAPPING_REQUIRED_ACTIONS.has(params.action)) {
    const ownsMapping = params.studentId && await ownsActiveMapping({
      actorUserId,
      schoolId: params.school.id,
      studentId: params.studentId,
      academicYear: params.academicYear ?? CURRENT_ACADEMIC_YEAR,
    });
    if (!ownsMapping) return denied(404, "Not found");
  }
  return {
    ok: true,
    email: params.email,
    permission: params.permission,
    canEdit: params.canEdit,
    actorUserId,
    school: params.school,
  };
}

export async function requireHolisticMentorshipAccess(
  session: HolisticMentorshipSession,
  action: HolisticMentorshipAction,
  options: { schoolCode?: string; studentId?: number; academicYear?: string } = {}
): Promise<HolisticMentorshipAccessResult> {
  const email = session?.user?.email;
  if (!email) return denied(401, "Unauthorized");
  if (session.isPasscodeUser) return denied(403, "Forbidden");

  const permission = await getResolvedPermission(email);
  const access = getFeatureAccess(permission, "holistic_mentorship");
  if (!permission || !access.canView) return denied(403, "Forbidden");

  const allowed = allowedActor(permission, action);
  if ((!allowed.program && !allowed.teacher) || (!READ_ONLY_ACTIONS.has(action) && !access.canEdit)) {
    return denied(403, "Forbidden");
  }

  const resolvedSchool = await resolveSchool(permission, options.schoolCode);
  if (resolvedSchool && "ok" in resolvedSchool) return resolvedSchool;
  const school = resolvedSchool as HolisticMentorshipSchool | undefined;

  if (allowed.teacher) {
    return teacherAccess({
      email,
      permission,
      canEdit: access.canEdit,
      action,
      school,
      studentId: options.studentId,
      academicYear: options.academicYear,
    });
  }

  return { ok: true, email, permission, canEdit: access.canEdit, school };
}
