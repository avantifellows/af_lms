// AI Test Insights (#550) access: the one place that decides whose Students a
// user may see. Server-only. Hiding the tab is never the gate; every AI Test
// Insights route asks this module first.
import { NextResponse } from "next/server";

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { query } from "@/lib/db";
import { PROGRAM_IDS } from "@/lib/constants";
import {
  canViewCentre,
  getCentreConfinement,
  getProgramContextSync,
  type UserPermission,
} from "@/lib/permissions";

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

/** The centres this user may list at the School before any named centre. */
function centresForUser(
  permission: UserPermission,
  centres: Array<{ id: number; programId: number }>,
  namedCentre: number | null,
): number[] | null {
  if (permission.role === "admin") return centres.map((centre) => centre.id);
  const confinement = getCentreConfinement(permission);
  if (confinement.confined) {
    // As the School page: a seat-confined user lists only from a Centre page.
    if (namedCentre === null) return null;
    return centres.filter((centre) => confinement.centreIds.includes(centre.id)).map((centre) => centre.id);
  }
  const { programIds } = getProgramContextSync(permission);
  return centres.filter((centre) => programIds.includes(centre.programId)).map((centre) => centre.id);
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
