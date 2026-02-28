import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

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
  const userToDelete = await query<{ email: string }>(
    `SELECT email FROM user_permission WHERE id = $1`,
    [id]
  );

  if (userToDelete.length > 0 && userToDelete[0].email.toLowerCase() === session.user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  await query(`DELETE FROM user_permission WHERE id = $1`, [id]);

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
      [level, userRole, school_codes || null, regions || null, program_ids || null, read_only, full_name ?? null, id]
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
