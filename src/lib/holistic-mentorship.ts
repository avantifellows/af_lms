import {
  CURRENT_ACADEMIC_YEAR,
  HOLISTIC_MENTORSHIP_PROGRAM_IDS,
  isHolisticMentorshipProgramId,
} from "./constants";
import { query } from "./db";
import { findEligibleHolisticMentorUserId } from "./holistic-mentor-eligibility";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import { buildHolisticSchoolScopePredicate } from "./holistic-scope";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getProgramContextSync,
  getResolvedPermission,
  type UserPermission,
} from "./permissions";

export type HolisticMentorshipAction =
  | "roster_view"
  | "assignment_coverage_read"
  | "mapping_mutation"
  | "admin_mapping_mutation"
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
      programId?: number;
      programIds?: number[];
      school?: HolisticMentorshipSchool;
    }
  | {
      ok: false;
      status: 401 | 403 | 404;
      error: "Unauthorized" | "Forbidden" | "School not found" | "Not found";
    };
type HolisticMentorshipAccessDenied = Extract<HolisticMentorshipAccessResult, { ok: false }>;

export interface HolisticMentorshipSchool {
  id: number;
  code: string;
  name: string;
  region: string | null;
  programId: number;
}

interface HolisticMentorshipSchoolRow
  extends Omit<HolisticMentorshipSchool, "id" | "programId"> {
  id: number | string;
  program_id: number | string;
}

const PROGRAM_ACTIONS = new Set<HolisticMentorshipAction>([
  "program_read",
  "assignment_coverage_read",
  "mapped_student_read",
  "phase_configure",
  "profile_regenerate",
  "admin_mapping_mutation",
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
  "assignment_coverage_read",
  "mapped_student_read",
  "roster_view",
]);

function denied(
  status: 401 | 403 | 404,
  error: "Unauthorized" | "Forbidden" | "School not found" | "Not found"
): HolisticMentorshipAccessDenied {
  return { ok: false, status, error };
}

async function findProgramSchool(
  schoolCode: string,
  programId?: number,
): Promise<HolisticMentorshipSchool | null> {
  const rows = await query<HolisticMentorshipSchoolRow>(
    `SELECT school.id, school.code, school.name, school.region,
            MIN(centre.program_id) AS program_id
     FROM school
     JOIN centres centre
       ON centre.school_id = school.id
      AND centre.program_id = ANY($2::bigint[])
      AND centre.is_active IS TRUE
     WHERE school.code = $1
       AND ($3::bigint IS NULL OR centre.program_id = $3)
     GROUP BY school.id, school.code, school.name, school.region
     HAVING COUNT(DISTINCT centre.program_id) = 1
     LIMIT 1`,
    [schoolCode, [...HOLISTIC_MENTORSHIP_PROGRAM_IDS], programId ?? null]
  );
  return rows[0]
    ? {
        id: Number(rows[0].id),
        code: rows[0].code,
        name: rows[0].name,
        region: rows[0].region,
        programId: Number(rows[0].program_id),
      }
    : null;
}

async function ownsActiveMapping(params: {
  actorUserId: number;
  schoolId: number;
  studentId: number;
  academicYear: string;
  programId: number;
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
       AND EXISTS (
         SELECT 1
         FROM student
         JOIN centre_students roster_student ON roster_student.user_id = student.user_id
         JOIN centres roster_centre
           ON roster_centre.id = roster_student.centre_id
          AND roster_centre.school_id = $2
          AND roster_centre.program_id = $4
          AND roster_centre.is_active IS TRUE
         WHERE student.id = $3
           AND student.status IS DISTINCT FROM 'dropout'
           AND roster_student.academic_year = $5
           AND roster_student.program_id = $4
           AND roster_student.grade IN (11, 12)
         HAVING COUNT(DISTINCT roster_student.grade) = 1
       )
     LIMIT 1`,
    [
      params.actorUserId,
      params.schoolId,
      params.studentId,
      params.programId,
      params.academicYear,
    ]
  );
  return rows.length > 0;
}

function allowedActor(permission: UserPermission, action: HolisticMentorshipAction) {
  const programWide = permission.role === "admin" || permission.role === "holistic_mentorship_admin";
  const scopedRead = permission.role === "program_manager" || permission.role === "program_admin";
  return {
    teacher: permission.role === "teacher" && TEACHER_ACTIONS.has(action),
    program: (programWide && PROGRAM_ACTIONS.has(action)) ||
      (scopedRead && (action === "program_read" || action === "assignment_coverage_read")),
  };
}

async function resolveScopedProgramIds(
  permission: UserPermission,
  requestedProgramId?: number,
): Promise<number[]> {
  const assignedPrograms = getProgramContextSync(permission).programIds;
  const candidates = HOLISTIC_MENTORSHIP_PROGRAM_IDS.filter((programId) =>
    assignedPrograms.includes(programId) &&
    (requestedProgramId === undefined || requestedProgramId === programId)
  );
  if (candidates.length === 0) return [];

  const schoolScope = buildHolisticSchoolScopePredicate(permission, {
    startIndex: 2,
    schoolCodeColumn: "school.code",
    schoolRegionColumn: "school.region",
  });
  const schoolScopeSql = schoolScope.clause ? `AND ${schoolScope.clause}` : "";
  const rows = await query<{ program_id: number | string }>(
    `SELECT DISTINCT centre.program_id
     FROM centres centre
     JOIN school ON school.id = centre.school_id
     WHERE centre.program_id = ANY($1::bigint[])
       AND centre.is_active IS TRUE
       ${schoolScopeSql}
     ORDER BY centre.program_id`,
    [candidates, ...schoolScope.params],
  );
  return rows.map(({ program_id }) => Number(program_id));
}

async function resolveSchool(
  permission: UserPermission,
  schoolCode?: string,
  programId?: number,
): Promise<HolisticMentorshipSchool | HolisticMentorshipAccessResult | undefined> {
  if (!schoolCode) return undefined;
  const school = await findProgramSchool(schoolCode, programId);
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
  const actorUserId = await findEligibleHolisticMentorUserId({
    email: params.email,
    schoolId: params.school.id,
    programId: params.school.programId,
  });
  if (actorUserId === null) return denied(403, "Forbidden");
  if (MAPPING_REQUIRED_ACTIONS.has(params.action)) {
    await reconcileHolisticMappings({
      academicYear: params.academicYear ?? CURRENT_ACADEMIC_YEAR,
      schoolId: params.school.id,
      studentIds: params.studentId ? [params.studentId] : undefined,
      programId: params.school.programId,
    });
    const ownsMapping = params.studentId && await ownsActiveMapping({
      actorUserId,
      schoolId: params.school.id,
      studentId: params.studentId,
      academicYear: params.academicYear ?? CURRENT_ACADEMIC_YEAR,
      programId: params.school.programId,
    });
    if (!ownsMapping) return denied(404, "Not found");
  }
  return {
    ok: true,
    email: params.email,
    permission: params.permission,
    canEdit: params.canEdit,
    actorUserId,
    programId: params.school.programId,
    school: params.school,
  };
}

function programAccess(params: {
  email: string;
  permission: UserPermission;
  canEdit: boolean;
  action: HolisticMentorshipAction;
  programId?: number;
  programIds?: number[];
  school?: HolisticMentorshipSchool;
}): HolisticMentorshipAccessResult {
  const actorUserId = params.permission.user_id == null
    ? undefined
    : Number(params.permission.user_id);
  return {
    ok: true,
    email: params.email,
    permission: params.permission,
    canEdit: params.canEdit,
    actorUserId,
    programId: params.school?.programId ?? params.programId,
    programIds: params.programIds,
    school: params.school,
  };
}

type AuthenticatedHolisticActor = {
  email: string;
  permission: UserPermission;
  canEdit: boolean;
};

async function resolveAuthenticatedActor(
  session: HolisticMentorshipSession,
): Promise<HolisticMentorshipAccessDenied | AuthenticatedHolisticActor> {
  const email = session?.user?.email;
  if (!email) return denied(401, "Unauthorized");
  if (session.isPasscodeUser) return denied(403, "Forbidden");
  const permission = await getResolvedPermission(email);
  const access = getFeatureAccess(permission, "holistic_mentorship");
  if (!permission || !access.canView) return denied(403, "Forbidden");
  return { email, permission, canEdit: access.canEdit };
}

async function resolveActorAccess(
  session: HolisticMentorshipSession,
  action: HolisticMentorshipAction,
): Promise<HolisticMentorshipAccessDenied | AuthenticatedHolisticActor & {
  allowed: ReturnType<typeof allowedActor>;
}> {
  const actor = await resolveAuthenticatedActor(session);
  if (accessDenied(actor)) return actor;
  if (action === "privacy_delete") return denied(403, "Forbidden");
  const allowed = allowedActor(actor.permission, action);
  if (!allowed.program && !allowed.teacher) return denied(403, "Forbidden");
  if (!READ_ONLY_ACTIONS.has(action) && !actor.canEdit) return denied(403, "Forbidden");
  return { ...actor, allowed };
}

function accessDenied(
  value: HolisticMentorshipAccessDenied | object,
): value is HolisticMentorshipAccessDenied {
  return "ok" in value;
}

export async function requireHolisticMentorshipAccess(
  session: HolisticMentorshipSession,
  action: HolisticMentorshipAction,
  options: {
    schoolCode?: string;
    studentId?: number;
    academicYear?: string;
    programId?: number;
  } = {}
): Promise<HolisticMentorshipAccessResult> {
  const actor = await resolveActorAccess(session, action);
  if (accessDenied(actor)) return actor;

  const requestedProgramId = options.programId;
  if (requestedProgramId !== undefined && !isHolisticMentorshipProgramId(requestedProgramId)) {
    return denied(404, "Not found");
  }
  const resolvedSchool = await resolveSchool(
    actor.permission,
    options.schoolCode,
    requestedProgramId,
  );
  if (resolvedSchool && "ok" in resolvedSchool) return resolvedSchool;
  const school = resolvedSchool as HolisticMentorshipSchool | undefined;
  const programId = school?.programId ?? requestedProgramId;
  if (action !== "program_read" && programId === undefined) {
    return denied(404, "Not found");
  }

  if (actor.allowed.teacher) {
    return teacherAccess({
      email: actor.email,
      permission: actor.permission,
      canEdit: actor.canEdit,
      action,
      school,
      studentId: options.studentId,
      academicYear: options.academicYear,
    });
  }

  const scopedProgramRead = action === "program_read" &&
    (actor.permission.role === "program_manager" || actor.permission.role === "program_admin");
  const scopedCoverageRead = action === "assignment_coverage_read" &&
    (actor.permission.role === "program_manager" || actor.permission.role === "program_admin");
  if (scopedCoverageRead && (
    programId === undefined ||
    !getProgramContextSync(actor.permission).programIds.includes(programId)
  )) return denied(403, "Forbidden");
  const programIds = scopedProgramRead
    ? await resolveScopedProgramIds(actor.permission, requestedProgramId)
    : scopedCoverageRead
      ? [programId!]
      : [...HOLISTIC_MENTORSHIP_PROGRAM_IDS];
  if (scopedProgramRead && programIds.length === 0) return denied(403, "Forbidden");

  if (MAPPING_REQUIRED_ACTIONS.has(action) && options.studentId) {
    await reconcileHolisticMappings({
      academicYear: options.academicYear ?? CURRENT_ACADEMIC_YEAR,
      schoolId: school?.id,
      studentIds: [options.studentId],
      programId: programId!,
    });
  }

  return programAccess({
    email: actor.email,
    permission: actor.permission,
    canEdit: actor.canEdit,
    action,
    programId: programId ?? programIds[0],
    programIds,
    school,
  });
}
