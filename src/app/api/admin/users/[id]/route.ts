import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query, withTransaction } from "@/lib/db";
import { blockIfAcademicMentorshipHistory } from "@/lib/staff-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// DELETE /api/admin/users/[id] - Delete user
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  if (userToDelete.length > 0 && userToDelete[0].email.toLowerCase() === session.user.email.toLowerCase()) {
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
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { level, role, school_codes, regions, program_ids, read_only, full_name } = body;

    if (level && (level < 1 || level > 3)) {
      return NextResponse.json(
        { error: "Level must be between 1 and 3" },
        { status: 400 }
      );
    }

    // Validate program_ids if provided
    if (program_ids !== undefined) {
      if (!Array.isArray(program_ids) || program_ids.length === 0) {
        return NextResponse.json(
          { error: "At least one program must be assigned" },
          { status: 400 }
        );
      }
    }

    const validRoles = ["teacher", "program_manager", "program_admin", "admin"];
    const userRole = role && validRoles.includes(role) ? role : undefined;

    // Centre seats are the source of truth for a seated user's school scope
    // (staff-admin clears school_codes/regions on assignment; resolveScope derives
    // schools from the seat). Editing explicit scope here would re-introduce the
    // over-grant / move-doesn't-revoke staleness, so it's disabled for seated
    // users: reject any attempt to set school_codes/regions, and keep both NULL.
    const seated = await query<{ one: number }>(
      `SELECT 1 AS one
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

    await query(
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
      [level, userRole, isSeated ? null : school_codes || null, isSeated ? null : regions || null, program_ids || null, read_only, full_name ?? null, id]
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
