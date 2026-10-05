import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import {
  blockIfAcademicMentorshipHistory,
  endIneligibleHolisticMappings,
} from "@/lib/staff-admin";
import { isUserRole } from "@/lib/permissions";
import { HOLISTIC_MENTORSHIP_PROGRAM_IDS, isPmuRole, type PmuRole } from "@/lib/constants";
import { requireAdminApiAccess } from "../../route-helpers";
import { isSeatedEmail, PMU_SEATED_ERROR, resolvePmuRow } from "../pmu-rows";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UserPatchBody {
  level?: number;
  role?: string;
  school_codes?: string[];
  regions?: string[];
  program_ids?: number[];
  read_only?: boolean;
  full_name?: string | null;
}

function validatePatch(body: UserPatchBody, isHolisticAdmin: boolean) {
  if (body.level && (body.level < 1 || body.level > 3)) {
    return NextResponse.json(
      { error: "Level must be between 1 and 3" },
      { status: 400 }
    );
  }

  if (
    !isHolisticAdmin &&
    body.program_ids !== undefined &&
    (!Array.isArray(body.program_ids) || body.program_ids.length === 0)
  ) {
    return NextResponse.json(
      { error: "At least one program must be assigned" },
      { status: 400 }
    );
  }

  return null;
}

function explicitScope(value: string[] | undefined, clear: boolean) {
  return clear ? null : value || null;
}

function assignedPrograms(programIds: number[] | undefined, isHolisticAdmin: boolean) {
  return isHolisticAdmin ? [...HOLISTIC_MENTORSHIP_PROGRAM_IDS] : programIds || null;
}

async function storedPermission(id: string) {
  const rows = await query<{
    email: string | null;
    level: number;
    role: string;
    school_codes: string[] | null;
    regions: string[] | null;
  }>(
    `SELECT email, level, role, school_codes, regions
     FROM user_permission
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function updatePermission(
  client: PoolClient,
  updateParams: unknown[],
  userRole: string | undefined,
  targetUserId: number
) {
  await client.query(
    `UPDATE user_permission
     SET level = COALESCE($1, level),
         role = COALESCE($2, role),
         school_codes = $3,
         regions = $4,
         program_ids = COALESCE($5, program_ids),
         read_only = COALESCE($6, read_only),
         full_name = $7,
         updated_at = NOW()
     WHERE id = $8`,
    updateParams
  );

  if (!userRole || userRole === "teacher" || !Number.isSafeInteger(targetUserId)) return;

  await endIneligibleHolisticMappings(
    client,
    targetUserId,
    "mentor_role_changed",
    true
  );
}

type StoredPermission = NonNullable<Awaited<ReturnType<typeof storedPermission>>>;

interface SeatedUser {
  isSeated: boolean;
  targetUserId: number;
}

const SEATED_SCOPE_ERROR =
  "This user is assigned to a centre, so their school scope is derived from that centre and can't be edited here. Change their centre assignment instead.";

function invalidRequest(body: UserPatchBody) {
  if (body.role !== undefined && !isUserRole(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  const isHolisticAdmin = body.role === "holistic_mentorship_admin";
  return validatePatch(body, isHolisticAdmin || isPmuRole(body.role));
}

// Centre seats are the source of truth for a seated user's school scope
// (staff-admin clears school_codes/regions on assignment; resolveScope derives
// schools from the seat). Editing explicit scope here would re-introduce the
// over-grant / move-doesn't-revoke staleness, so it's disabled for seated
// users: reject any attempt to set school_codes/regions, and keep both NULL.
async function seatedUser(id: string): Promise<SeatedUser> {
  const seated = await query<{ one: number; user_id: number | string }>(
    `SELECT 1 AS one, up.user_id
     FROM centre_positions cp
     JOIN user_permission up ON up.user_id = cp.user_id
     WHERE up.id = $1 AND cp.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return { isSeated: seated.length > 0, targetUserId: Number(seated[0]?.user_id) };
}

// The seat check above joins on user_id only; a row Admin created carries just
// an email, so also look the seat up by the stored email.
async function pmuSeatTaken(isSeated: boolean, stored: StoredPermission | null) {
  if (isSeated) return true;
  return Boolean(stored?.email && (await isSeatedEmail(stored.email)));
}

function wantsScopeEdit({ school_codes, regions }: UserPatchBody) {
  return (
    (Array.isArray(school_codes) && school_codes.length > 0) ||
    (Array.isArray(regions) && regions.length > 0)
  );
}

// A PMU row is validated as the stored row with the body merged over it, so
// a role-only change can't leave a multi-school Govt School User behind.
async function storedForPmuCheck(id: string, role: string | undefined) {
  return role === undefined || isPmuRole(role) ? storedPermission(id) : null;
}

async function applyPatch(id: string, body: UserPatchBody) {
  const seat = await seatedUser(id);
  const stored = await storedForPmuCheck(id, body.role);
  const effectiveRole = body.role ?? stored?.role;
  const isPmu = isPmuRole(effectiveRole);

  // The PMU seat rule runs before the seated-scope rule below, so a seated
  // user given a PMU role always gets PMU_SEATED_ERROR, even when the body
  // also carries school_codes/regions.
  if (isPmu && (await pmuSeatTaken(seat.isSeated, stored))) {
    return NextResponse.json({ error: PMU_SEATED_ERROR }, { status: 409 });
  }

  if (seat.isSeated && wantsScopeEdit(body)) {
    return NextResponse.json({ error: SEATED_SCOPE_ERROR }, { status: 409 });
  }

  if (isPmu) return updatePmuUser(id, body, effectiveRole, stored, seat);

  // Moving off a PMU role must say which programs the user gets; otherwise the
  // stored [64] would silently carry over.
  if (body.program_ids === undefined && body.role !== "holistic_mentorship_admin") {
    const current = stored ?? (await storedPermission(id));
    if (current && isPmuRole(current.role)) {
      return NextResponse.json(
        { error: "program_ids is required when moving a user off a PMU role" },
        { status: 400 }
      );
    }
  }
  return updateStandardUser(id, body, seat);
}

async function updatePmuUser(
  id: string,
  body: UserPatchBody,
  role: PmuRole,
  stored: StoredPermission | null,
  seat: SeatedUser
) {
  const { school_codes, regions } = body;
  const resolved = await resolvePmuRow({
    role,
    level: body.level ?? stored?.level,
    school_codes: school_codes !== undefined ? school_codes : stored?.school_codes,
    regions: regions !== undefined ? regions : stored?.regions,
  });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }
  const { row } = resolved;
  await withTransaction((client) =>
    updatePermission(
      client,
      [row.level, body.role, row.school_codes, row.regions, row.program_ids,
        body.read_only, body.full_name ?? null, id],
      body.role,
      seat.targetUserId
    )
  );
  return NextResponse.json({ success: true });
}

async function updateStandardUser(id: string, body: UserPatchBody, seat: SeatedUser) {
  const userRole = body.role;
  const isHolisticAdmin = userRole === "holistic_mentorship_admin";
  const clearExplicitScope = isHolisticAdmin || seat.isSeated;
  const updateParams = [
    isHolisticAdmin ? 3 : body.level,
    userRole,
    explicitScope(body.school_codes, clearExplicitScope),
    explicitScope(body.regions, clearExplicitScope),
    assignedPrograms(body.program_ids, isHolisticAdmin),
    body.read_only,
    body.full_name ?? null,
    id,
  ];
  await withTransaction((client) =>
    updatePermission(client, updateParams, userRole, seat.targetUserId)
  );

  return NextResponse.json({ success: true });
}

// DELETE /api/admin/users/[id] - Delete user
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const access = await requireAdminApiAccess({ forWrite: true });
  const { id } = await params;
  if (!access.ok) return access.response;

  // Prevent deleting yourself
  const userToDelete = await query<{ email: string; user_id: number | null }>(
    `SELECT up.email,
            COALESCE(up.user_id, u.id) AS user_id
     FROM user_permission up
     LEFT JOIN "user" u
       ON up.user_id IS NULL
      AND LOWER(u.email) = LOWER(up.email)
     WHERE up.id = $1
     ORDER BY u.id
     LIMIT 1`,
    [id]
  );

  if (userToDelete.length > 0 && userToDelete[0].email.toLowerCase() === access.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  // Removing a user also frees their centre seats: soft-delete the person's
  // active centre_positions so they vacate the centre (and stop appearing in
  // Staff Management). We deliberately do NOT delete the teacher/staff/user
  // rows — those live in the shared db-service DB and may be referenced by
  // other systems; the roster already hides them once no live permission
  // exists, and a later re-add reactivates the dormant record.
  const targetUserId = userToDelete[0]?.user_id ?? null;
  if (targetUserId != null) {
    const blocker = await blockIfAcademicMentorshipHistory(Number(targetUserId));
    if (blocker) {
      return NextResponse.json(
        { error: blocker.error, code: blocker.code },
        { status: blocker.status }
      );
    }
  }

  await withTransaction(async (client) => {
    if (targetUserId != null) {
      await endIneligibleHolisticMappings(
        client,
        Number(targetUserId),
        "mentor_access_revoked",
        true
      );
      await client.query(
        `UPDATE centre_positions SET deleted_at = now(), updated_at = now()
         WHERE user_id = $1 AND deleted_at IS NULL`,
        [targetUserId]
      );
    }
    await client.query(`DELETE FROM user_permission WHERE id = $1`, [id]);
  });

  return NextResponse.json({ success: true });
}

// PATCH /api/admin/users/[id] - Update user
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const access = await requireAdminApiAccess({ forWrite: true });
  const { id } = await params;
  if (!access.ok) return access.response;

  try {
    const body = (await request.json()) as UserPatchBody;
    const invalid = invalidRequest(body);
    if (invalid) return invalid;
    return await applyPatch(id, body);
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
