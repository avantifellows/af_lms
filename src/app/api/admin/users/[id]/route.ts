import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/db";
import {
  blockIfAcademicMentorshipHistory,
  endIneligibleHolisticMappings,
} from "@/lib/staff-admin";
import { requireAdminApiAccess } from "../../route-helpers";

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

const VALID_ROLES = [
  "teacher",
  "program_manager",
  "program_admin",
  "holistic_mentorship_admin",
  "admin",
];

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
  return isHolisticAdmin ? [1] : programIds || null;
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

// DELETE /api/admin/users/[id] - Delete user
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const access = await requireAdminApiAccess();
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
  const access = await requireAdminApiAccess();
  const { id } = await params;
  if (!access.ok) return access.response;

  try {
    const body = (await request.json()) as UserPatchBody;
    const { role, school_codes, regions } = body;
    const userRole = role && VALID_ROLES.includes(role) ? role : undefined;
    const isHolisticAdmin = userRole === "holistic_mentorship_admin";
    const validationError = validatePatch(body, isHolisticAdmin);
    if (validationError) return validationError;

    // Centre seats are the source of truth for a seated user's school scope
    // (staff-admin clears school_codes/regions on assignment; resolveScope derives
    // schools from the seat). Editing explicit scope here would re-introduce the
    // over-grant / move-doesn't-revoke staleness, so it's disabled for seated
    // users: reject any attempt to set school_codes/regions, and keep both NULL.
    const seated = await query<{ one: number; user_id: number | string }>(
      `SELECT 1 AS one, up.user_id
       FROM centre_positions cp
       JOIN user_permission up ON up.user_id = cp.user_id
       WHERE up.id = $1 AND cp.deleted_at IS NULL
       LIMIT 1`,
      [id]
    );
    const isSeated = seated.length > 0;
    const wantsScopeEdit =
      (Array.isArray(school_codes) && school_codes.length > 0) ||
      (Array.isArray(regions) && regions.length > 0);
    if (isSeated && wantsScopeEdit) {
      return NextResponse.json(
        {
          error:
            "This user is assigned to a centre, so their school scope is derived from that centre and can't be edited here. Change their centre assignment instead.",
        },
        { status: 409 }
      );
    }

    const clearExplicitScope = isHolisticAdmin || isSeated;
    const updateParams = [
      isHolisticAdmin ? 3 : body.level,
      userRole,
      explicitScope(school_codes, clearExplicitScope),
      explicitScope(regions, clearExplicitScope),
      assignedPrograms(body.program_ids, isHolisticAdmin),
      body.read_only,
      body.full_name ?? null,
      id,
    ];
    const targetUserId = Number(seated[0]?.user_id);
    await withTransaction((client) =>
      updatePermission(client, updateParams, userRole, targetUserId)
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
