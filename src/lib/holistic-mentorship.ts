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

export async function requireHolisticMentorshipAccess(
  session: HolisticMentorshipSession,
  action: HolisticMentorshipAction,
  options: { schoolCode?: string; studentId?: number; academicYear?: string } = {}
): Promise<HolisticMentorshipAccessResult> {
  const email = session?.user?.email;
  if (!email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (session.isPasscodeUser) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const permission = await getResolvedPermission(email);
  const access = getFeatureAccess(permission, "holistic_mentorship");
  if (!permission || !access.canView) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const isProgramAdmin =
    permission.role === "admin" || permission.role === "holistic_mentorship_admin";
  const readAction = action === "program_read" || action === "mapped_student_read";
  const programActionAllowed =
    (action === "privacy_delete" && permission.role === "admin") ||
    (isProgramAdmin &&
      ["program_read", "mapped_student_read", "phase_configure", "profile_regenerate"].includes(
        action
      ));
  const teacherActionAllowed =
    permission.role === "teacher" &&
    [
      "roster_view",
      "mapping_mutation",
      "mapped_student_read",
      "notes_draft",
      "notes_submit",
      "notes_edit",
    ].includes(action);

  if ((!programActionAllowed && !teacherActionAllowed) || (!readAction && action !== "roster_view" && !access.canEdit)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  let school: HolisticMentorshipSchool | undefined;
  if (options.schoolCode) {
    school = (await findProgramSchool(options.schoolCode)) ?? undefined;
    if (!school) {
      return { ok: false, status: 404, error: "School not found" };
    }
    if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined)) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
  }

  if (teacherActionAllowed) {
    if (!school) return { ok: false, status: 403, error: "Forbidden" };
    const actorUserId = await findEligibleTeacherUserId(email, school.id);
    if (actorUserId === null) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    if (["mapped_student_read", "notes_draft", "notes_submit", "notes_edit"].includes(action)) {
      if (
        !options.studentId ||
        !(await ownsActiveMapping({
          actorUserId,
          schoolId: school.id,
          studentId: options.studentId,
          academicYear: options.academicYear ?? CURRENT_ACADEMIC_YEAR,
        }))
      ) {
        return { ok: false, status: 404, error: "Not found" };
      }
    }
    return { ok: true, email, permission, canEdit: access.canEdit, actorUserId, school };
  }

  return { ok: true, email, permission, canEdit: access.canEdit, school };
}
