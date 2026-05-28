import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";
import { getAcademicYearChoices } from "@/lib/academic-year";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UserDeletionRow {
  email: string;
  role: string | null;
  level: number | null;
  school_codes: string[] | null;
  regions: string[] | null;
}

interface DbServiceMappingResponse {
  mappings?: unknown[];
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function normalizeStringArray(value: unknown): string[] | null {
  return Array.isArray(value) ? value.map(String) : null;
}

function arraysEqualIgnoringOrder(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

async function countActiveMentorshipMappings(mentorId: string): Promise<number> {
  const dbServiceUrl = process.env.DB_SERVICE_URL;
  const dbServiceToken = process.env.DB_SERVICE_TOKEN;

  if (!dbServiceUrl || !dbServiceToken) {
    throw new Error("Missing db-service configuration");
  }

  let activeMappingCount = 0;
  for (const academicYear of getAcademicYearChoices()) {
    const params = new URLSearchParams({
      mentor_ids: mentorId,
      academic_year: academicYear,
    });
    const response = await fetch(
      `${dbServiceUrl}/api/academic-mentorship-mapping?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${dbServiceToken}`,
          accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("db-service academic mentorship mapping fetch failed");
    }

    const data = (await response.json()) as DbServiceMappingResponse;
    activeMappingCount += data.mappings?.length ?? 0;
  }

  return activeMappingCount;
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
  const userToDelete = await query<UserDeletionRow>(
    `SELECT email, role, level, school_codes, regions FROM user_permission WHERE id = $1`,
    [id]
  );

  if (userToDelete.length > 0 && userToDelete[0].email.toLowerCase() === session.user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  if (userToDelete[0]?.role === "teacher") {
    try {
      const activeMappingCount = await countActiveMentorshipMappings(id);
      if (activeMappingCount > 0) {
        return NextResponse.json(
          {
            error: `Cannot delete teacher — ${activeMappingCount} active mentee assignment(s) exist. Unassign all mentees first.`,
          },
          { status: 409 }
        );
      }
    } catch (error) {
      console.error("Error verifying academic mentorship status:", error);
      return NextResponse.json(
        { error: "Cannot verify mentorship status — please try again later." },
        { status: 503 }
      );
    }
  }

  try {
    await query(`DELETE FROM user_permission WHERE id = $1`, [id]);
  } catch (error) {
    if (isPostgresError(error, "23503")) {
      return NextResponse.json(
        {
          error:
            "Cannot delete teacher — historical mentorship records exist. Contact an administrator to purge historical records before deletion.",
        },
        { status: 409 }
      );
    }
    throw error;
  }

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
    const body = (await request.json()) as Record<string, unknown>;
    const { level, role, school_codes, regions, program_ids, read_only, full_name } = body;

    if (typeof level === "number" && (level < 1 || level > 3)) {
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
    const userRole = typeof role === "string" && validRoles.includes(role) ? role : undefined;

    const existingUsers = await query<UserDeletionRow>(
      `SELECT email, role, level, school_codes, regions FROM user_permission WHERE id = $1`,
      [id]
    );
    const existingUser = existingUsers[0];
    const nextLevel = typeof level === "number" ? level : existingUser?.level ?? null;
    const nextRole = userRole ?? existingUser?.role ?? null;
    const nextSchoolCodes = hasOwn(body, "school_codes")
      ? normalizeStringArray(school_codes)
      : existingUser?.school_codes ?? null;
    const nextRegions = hasOwn(body, "regions")
      ? normalizeStringArray(regions)
      : existingUser?.regions ?? null;

    const changesMentorScope =
      existingUser?.role === "teacher" &&
      (nextRole !== existingUser.role ||
        nextLevel !== existingUser.level ||
        !arraysEqualIgnoringOrder(nextSchoolCodes, existingUser.school_codes) ||
        !arraysEqualIgnoringOrder(nextRegions, existingUser.regions));

    if (changesMentorScope) {
      try {
        const activeMappingCount = await countActiveMentorshipMappings(id);
        if (activeMappingCount > 0) {
          return NextResponse.json(
            {
              error: `Cannot update teacher — ${activeMappingCount} active mentee assignment(s) exist. Unassign or reassign all mentees before changing role or school access.`,
            },
            { status: 409 }
          );
        }
      } catch (error) {
        console.error("Error verifying academic mentorship status:", error);
        return NextResponse.json(
          { error: "Cannot verify mentorship status — please try again later." },
          { status: 503 }
        );
      }
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
      [
        level,
        userRole,
        nextSchoolCodes,
        nextRegions,
        program_ids || null,
        read_only,
        full_name ?? null,
        id,
      ]
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
