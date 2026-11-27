// AI Test Insights (#550) access: the one place that decides whose Students a
// user may see. Server-only. Hiding the tab is never the gate; every AI Test
// Insights route asks this module first.
import { NextResponse } from "next/server";

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { isPhysicalCentreProgramId } from "@/lib/ai-test-insights-shared";
import { listedStudentRowsSql } from "@/lib/ai-test-insights-students";
import { query } from "@/lib/db";
import { PROGRAM_IDS } from "@/lib/constants";
import {
  canAccessSchoolSync,
  canViewCentre,
  getCentreConfinement,
  getFeatureAccess,
  getProgramContextSync,
  getResolvedPermission,
  type UserPermission,
} from "@/lib/permissions";
import { getSession } from "@/lib/session";

export interface AiTestInsightsListScope {
  authorized: true;
  school: { id: string; code: string; region: string | null };
  /** The centres whose listed Students this user may see; never empty. */
  centreIds: number[];
}

type Refusal = { authorized: false; response: NextResponse };

const refuse = (): Refusal => ({
  authorized: false,
  response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
});

/** Active centres of the School whose Program is a physical-centre one. */
async function physicalCentresOfSchool(schoolId: string): Promise<Array<{ id: number; programId: number }>> {
  const rows = await query<{ id: string | number; program_id: string | number }>(
    `SELECT id, program_id
     FROM centres
     WHERE school_id = $1
       AND is_active IS TRUE
       AND program_id IS NOT NULL
       AND program_id <> $2
     ORDER BY id`,
    [schoolId, PROGRAM_IDS.NVS],
  );
  return rows.map((row) => ({ id: Number(row.id), programId: Number(row.program_id) }));
}

function parseCentreId(raw: string | null): number | null | "invalid" {
  if (raw === null) return null;
  return /^[1-9][0-9]{0,17}$/.test(raw) ? Number(raw) : "invalid";
}

/**
 * The centres this user may list at the School before any named centre.
 * Seat confinement comes first, for every role: an Admin below level 3 who
 * holds a centre seat is confined to it like anyone else (PR #573 review).
 * Only an unconfined Admin lists every centre.
 */
function centresForUser(
  permission: UserPermission,
  centres: Array<{ id: number; programId: number }>,
  namedCentre: number | null,
): number[] | null {
  const confinement = getCentreConfinement(permission);
  if (confinement.confined) {
    // As the School page: a seat-confined user lists only from a Centre page.
    if (namedCentre === null) return null;
    return centres.filter((centre) => confinement.centreIds.includes(centre.id)).map((centre) => centre.id);
  }
  if (permission.role === "admin") return centres.map((centre) => centre.id);
  const { programIds } = getProgramContextSync(permission);
  return centres.filter((centre) => programIds.includes(centre.programId)).map((centre) => centre.id);
}

/**
 * Whether the AI Test Insights tab shows on a roster page: the list route's
 * scope rule (`centresForUser`) applied to the page's active physical-centre
 * centres, so the tab never shows where its list would answer 403 (PR #573
 * review). The page has already checked School access, the centre (seat) and
 * the feature view, and its centre or `centre_program_ids` hold only active
 * centres, as the route reads them.
 *
 * - Centre page: its centre, when its Program is a physical-centre one.
 * - School page: one stand-in centre per active physical-centre Program. Only
 *   their Programs matter: admin lists them all, a seat-confined user gets no
 *   tab on a School page (the route refuses them without a centre), and anyone
 *   else needs one of those Programs in their program context.
 */
export function aiTestInsightsTabHasScope(
  permission: UserPermission,
  page: { centreId: number; programId: number | null } | { centreProgramIds: number[] },
): boolean {
  if ("centreId" in page) {
    if (!isPhysicalCentreProgramId(page.programId)) return false;
    const centres = [{ id: page.centreId, programId: Number(page.programId) }];
    return (centresForUser(permission, centres, page.centreId)?.length ?? 0) > 0;
  }
  const centres = page.centreProgramIds
    .filter(isPhysicalCentreProgramId)
    .map((programId, index) => ({ id: -1 - index, programId: Number(programId) }));
  return (centresForUser(permission, centres, null)?.length ?? 0) > 0;
}

/**
 * List scope for the AI Test Insights Tab: given the School (code or UDISE)
 * and an optional centre, the centres whose listed Students the signed-in user
 * may see. Refuses, in this order and before any Student read: 401 no session,
 * 404 School not found, 403 no School access, 403 no `ai_test_insights` view,
 * 403 no physical-centre scope for this user.
 *
 * - Admin: every active centre of the School with a physical-centre Program.
 * - A user confined to centre seats: only their seat centres; refused on the
 *   School route without a centre.
 * - Other users with School access: the School's active physical centres
 *   whose Program is in their program context.
 * - A named centre must be one of those and pass `canViewCentre`.
 */
export async function resolveAiTestInsightsListScope(
  udise: string,
  rawCentreId: string | null,
): Promise<AiTestInsightsListScope | Refusal> {
  const auth = await authorizeSchoolAccess(udise, { feature: "ai_test_insights" });
  if (!auth.authorized) return auth;
  const permission = auth.permission;
  if (!permission) return refuse();

  const namedCentre = parseCentreId(rawCentreId);
  if (namedCentre === "invalid") return refuse();

  const centres = await physicalCentresOfSchool(auth.school.id);
  let centreIds = centresForUser(permission, centres, namedCentre);
  if (centreIds === null) return refuse();
  if (namedCentre !== null) {
    const mayView = canViewCentre(permission, {
      centreId: namedCentre,
      schoolCode: auth.school.code,
      schoolRegion: auth.school.region || undefined,
    });
    centreIds = mayView ? centreIds.filter((id) => id === namedCentre) : [];
  }
  if (centreIds.length === 0) return refuse();

  return {
    authorized: true,
    school: { id: auth.school.id, code: auth.school.code, region: auth.school.region },
    centreIds,
  };
}

/** Who a Student is, for every AI Test Insights Student page and route. */
export interface AiTestInsightsStudentContext {
  /** `student.id`. */
  studentId: number;
  /** The Student's `user.id`, which the warehouse keys test results by. */
  userId: number;
  /** The School of the centre that lists the Student. */
  school: { id: number; code: string; udise: string | null };
  /** The centre that lists the Student: the page's when the user may list it, otherwise the lowest id. */
  centreId: number;
  /** The Program of that centre. */
  programId: number;
  grade: 11 | 12;
  /** Feature access is `edit` (a Teacher who is not `read_only`). */
  canEdit: boolean;
}

export type AiTestInsightsStudentRefusal = {
  authorized: false;
  status: 401 | 403 | 404 | 422;
  response: NextResponse;
};

/** Who is asking: the signed-in email and the `user` their permission links, if any. */
export interface AiTestInsightsActor {
  email: string;
  /** `user_permission.user_id`; null when the permission links no User. */
  linkedUserId: number | null;
}

export type AiTestInsightsStudentAccess =
  | {
      authorized: true;
      student: AiTestInsightsStudentContext;
      /** The `centre` the page named is the context's centre (a valid one). */
      centreNamedByPage: boolean;
      actor: AiTestInsightsActor;
    }
  | AiTestInsightsStudentRefusal;

const REFUSAL_MESSAGES = {
  401: "Unauthorized",
  403: "Access denied",
  404: "Student not found",
  422: "Invalid student id",
} as const;

function refuseStudent(status: AiTestInsightsStudentRefusal["status"]): AiTestInsightsStudentRefusal {
  return { authorized: false, status, response: NextResponse.json({ error: REFUSAL_MESSAGES[status] }, { status }) };
}

/** A path id: a whole number 1 or more, written plainly (`"07"`, `"1.5"`, `"-1"` are not ids). */
export function parseAiTestInsightsId(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

type ListedStudentRow = {
  student_id: string | number;
  user_id: string | number;
  centre_id: string | number;
  program_id: string | number;
  grade: string | number;
  school_id: string | number;
  school_code: string;
  school_udise: string | null;
  school_region: string | null;
};

/** The centres that list this Student, one row per centre, lowest id first. */
async function listedRowsOfStudent(studentId: number): Promise<ListedStudentRow[]> {
  const listed = listedStudentRowsSql(2);
  return query<ListedStudentRow>(
    `WITH listed AS (${listed.sql})
     SELECT listed.student_id,
            listed.user_id,
            listed.centre_id,
            listed.program_id,
            listed.grade,
            sch.id AS school_id,
            sch.code AS school_code,
            sch.udise_code AS school_udise,
            sch.region AS school_region
     FROM listed
     JOIN centres c ON c.id = listed.centre_id
     JOIN school sch ON sch.id = c.school_id
     WHERE listed.student_id = $1
     ORDER BY listed.centre_id`,
    [studentId, ...listed.params],
  );
}

/** "This user may list this centre's Students" — the list scope's rule for one centre. */
function mayListCentre(permission: UserPermission, row: ListedStudentRow): boolean {
  if (!canAccessSchoolSync(permission, row.school_code, row.school_region || undefined)) return false;
  const centreId = Number(row.centre_id);
  const centres = [{ id: centreId, programId: Number(row.program_id) }];
  return centresForUser(permission, centres, centreId)?.includes(centreId) ?? false;
}

/**
 * Student access for AI Test Insights: the one helper every Student page and
 * route calls. Given a `student.id` from the URL, returns the Student's
 * context or a refusal, in this order: 401 no session, 422 bad id, 403 no
 * `ai_test_insights` view, (for a `write`, 403 when access is not `edit`),
 * 404 Student missing, not listed, or in no centre the user may list.
 *
 * The Student must be listed (the same predicate as the tab's list) by a
 * centre the user may list. A Student listed by two such centres counts once:
 * the context uses the page's `centre` when it is one of them, otherwise the
 * lowest centre id. That centre's School and Program are what the page shows
 * and what a new Insight Request records. `centre` changes nothing else; an
 * invalid one is ignored.
 * No mentor-mentee mapping applies.
 */
export async function resolveAiTestInsightsStudentAccess(
  rawStudentId: string,
  options: { centre?: string | null; write?: boolean } = {},
): Promise<AiTestInsightsStudentAccess> {
  const session = await getSession();
  if (!session) return refuseStudent(401);
  const studentId = parseAiTestInsightsId(rawStudentId);
  if (studentId === null) return refuseStudent(422);

  const email = session.user?.email;
  const permission = email ? await getResolvedPermission(email) : null;
  const access = getFeatureAccess(permission, "ai_test_insights");
  if (!email || !permission || !access.canView) return refuseStudent(403);
  if (options.write && !access.canEdit) return refuseStudent(403);

  const rows = (await listedRowsOfStudent(studentId)).filter((row) => mayListCentre(permission, row));
  if (rows.length === 0) return refuseStudent(404);

  const named = parseCentreId(options.centre ?? null);
  const byPage = rows.find((row) => Number(row.centre_id) === named);
  const chosen = byPage ?? rows.reduce((low, row) => (Number(row.centre_id) < Number(low.centre_id) ? row : low));

  return {
    authorized: true,
    student: {
      studentId,
      userId: Number(chosen.user_id),
      school: { id: Number(chosen.school_id), code: chosen.school_code, udise: chosen.school_udise },
      centreId: Number(chosen.centre_id),
      programId: Number(chosen.program_id),
      grade: Number(chosen.grade) as 11 | 12,
      canEdit: access.canEdit,
    },
    centreNamedByPage: byPage !== undefined,
    actor: { email, linkedUserId: permission.user_id != null ? Number(permission.user_id) : null },
  };
}
