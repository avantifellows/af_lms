import {
  ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST,
  CURRENT_ACADEMIC_YEAR,
} from "./constants";
import { query } from "./db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getAccessibleSchoolCodes,
  getProgramContextSync,
  getResolvedPermission,
  type UserPermission,
} from "./permissions";

export type AcademicMentorshipAction = "view" | "edit";

export type AcademicMentorshipSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

export interface AcademicMentorshipSchool {
  id: number;
  code: string;
  name: string;
  region: string | null;
}

export type AcademicMentorshipAccessResult =
  | { ok: true; email: string; permission: UserPermission; canEdit: boolean; school?: AcademicMentorshipSchool }
  | { ok: false; status: 401 | 403 | 404; error: "Unauthorized" | "Forbidden" | "School not found" };

export function isValidAcademicYear(value: string): boolean {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}

export function getAcademicMentorshipAcademicYears(
  currentAcademicYear = CURRENT_ACADEMIC_YEAR
): string[] {
  const start = Number(currentAcademicYear.slice(0, 4));
  return [0, 1, 2].map((offset) => {
    const year = start - offset;
    return `${year}-${year + 1}`;
  });
}

export function isAcademicMentorshipEditableYear(year: string): boolean {
  return getAcademicMentorshipAcademicYears().includes(year);
}

interface AcademicMentorshipMappingRow {
  id: number | string;
  mentor_user_id: number | string;
  mentor_name: string | null;
  mentor_email: string | null;
  student_pk_id: number | string;
  mentee_name: string | null;
  mentee_student_id: string | null;
  mentee_grade: number | null;
  assigned_date: string;
  ended_date: string | null;
}

export interface AcademicMentorshipMappingGroup {
  mentor: {
    userId: number;
    name: string;
    email: string | null;
  };
  menteeCount: number;
  mappings: Array<{
    id: number | string;
    mentee: {
      studentPkId: number;
      name: string;
      studentId: string | null;
      grade: number | null;
    };
    assignedDate: string;
    endedDate: string | null;
    status: "active" | "historical";
  }>;
}

function hasAcademicMentorshipProgramAccess(permission: UserPermission): boolean {
  if (ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST.includes("*")) return true;
  const allowed = new Set<number>(
    ACADEMIC_MENTORSHIP_PROGRAM_ALLOWLIST.map((id) => Number(id))
  );
  const context = getProgramContextSync(permission);
  return context.programIds.some((id) => allowed.has(id));
}

export async function requireAcademicMentorshipAccess(
  session: AcademicMentorshipSession,
  _action: AcademicMentorshipAction,
  options: { schoolCode?: string } = {}
): Promise<AcademicMentorshipAccessResult> {
  const email = session?.user?.email;
  if (!email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (session.isPasscodeUser) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const permission = await getResolvedPermission(email);
  if (!permission || !hasAcademicMentorshipProgramAccess(permission)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const access = getFeatureAccess(permission, "academic_mentorship");
  if (!access.canView || (_action === "edit" && !access.canEdit)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (options.schoolCode) {
    const schools = await query<AcademicMentorshipSchool>(
      `SELECT id, code, name, region
       FROM school
       WHERE code = $1
       LIMIT 1`,
      [options.schoolCode]
    );
    const school = schools[0];
    if (!school) {
      return { ok: false, status: 404, error: "School not found" };
    }
    if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined)) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
    return { ok: true, email, permission, canEdit: access.canEdit, school };
  }

  return { ok: true, email, permission, canEdit: access.canEdit };
}

export async function listAcademicMentorshipMappings(params: {
  schoolId: number;
  academicYear: string;
  includeHistory: boolean;
}): Promise<AcademicMentorshipMappingGroup[]> {
  const rows = await query<AcademicMentorshipMappingRow>(
    `SELECT
       m.id,
       m.mentor_user_id,
       NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name,
       mentor.email AS mentor_email,
       st.id AS student_pk_id,
       NULLIF(TRIM(COALESCE(mentee.first_name, '') || ' ' || COALESCE(mentee.last_name, '')), '') AS mentee_name,
       st.student_id AS mentee_student_id,
       gr.number AS mentee_grade,
       m.assigned_at::date::text AS assigned_date,
       m.ended_at::date::text AS ended_date
     FROM academic_mentorship_mentor_mentee_mappings m
     JOIN "user" mentor ON mentor.id = m.mentor_user_id
     JOIN student st ON st.id = m.student_id
     JOIN "user" mentee ON mentee.id = st.user_id
     LEFT JOIN enrollment_record er_grade
       ON er_grade.user_id = mentee.id
      AND er_grade.group_type = 'grade'
      AND er_grade.is_current = true
      AND er_grade.academic_year = m.academic_year
     LEFT JOIN grade gr ON gr.id = er_grade.group_id
     WHERE m.school_id = $1
       AND m.academic_year = $2
       AND ($3::boolean OR m.ended_at IS NULL)
     ORDER BY mentor_name ASC NULLS LAST, mentor.email ASC, gr.number ASC NULLS LAST, mentee_name ASC NULLS LAST, st.student_id ASC`,
    [params.schoolId, params.academicYear, params.includeHistory]
  );

  const groups = new Map<number, AcademicMentorshipMappingGroup>();
  for (const row of rows) {
    const mentorUserId = Number(row.mentor_user_id);
    const mentorName = row.mentor_name || row.mentor_email || "Unknown mentor";
    const group =
      groups.get(mentorUserId) ??
      {
        mentor: {
          userId: mentorUserId,
          name: mentorName,
          email: row.mentor_email,
        },
        menteeCount: 0,
        mappings: [],
      };
    group.mappings.push({
      id: row.id,
      mentee: {
        studentPkId: Number(row.student_pk_id),
        name: row.mentee_name || row.mentee_student_id || "Unknown student",
        studentId: row.mentee_student_id,
        grade: row.mentee_grade === null ? null : Number(row.mentee_grade),
      },
      assignedDate: row.assigned_date,
      endedDate: row.ended_date,
      status: row.ended_date ? "historical" : "active",
    });
    group.menteeCount = group.mappings.length;
    groups.set(mentorUserId, group);
  }

  return [...groups.values()];
}

export async function listAccessibleAcademicMentorshipSchools(
  permission: UserPermission
): Promise<AcademicMentorshipSchool[]> {
  const schoolCodes = await getAccessibleSchoolCodes(permission.email, permission);
  if (schoolCodes !== "all" && schoolCodes.length === 0) return [];

  if (schoolCodes === "all") {
    return query<AcademicMentorshipSchool>(
      `SELECT id, code, name, region
       FROM school
       ORDER BY name ASC, code ASC`
    );
  }

  return query<AcademicMentorshipSchool>(
    `SELECT id, code, name, region
     FROM school
     WHERE code = ANY($1)
     ORDER BY name ASC, code ASC`,
    [schoolCodes]
  );
}
