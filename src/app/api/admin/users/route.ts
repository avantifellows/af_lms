import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET /api/admin/users - List all users
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await query<{
    id: number;
    email: string;
    level: number;
    role: string;
    school_codes: string[] | null;
    regions: string[] | null;
    read_only: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, email, level, role, school_codes, regions, read_only, created_at, updated_at
     FROM user_permission
     ORDER BY level DESC, role, email`
  );

  return NextResponse.json(users);
}

// POST /api/admin/users - Create new user
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { email, level, role, school_codes, regions, read_only } = body;

    if (!email || !level) {
      return NextResponse.json(
        { error: "Email and level are required" },
        { status: 400 }
      );
    }

    if (level < 1 || level > 4) {
      return NextResponse.json(
        { error: "Level must be between 1 and 4" },
        { status: 400 }
      );
    }

    const validRoles = ["teacher", "program_manager", "admin"];
    const userRole = validRoles.includes(role) ? role : "teacher";

    const result = await query<{ id: number }>(
      `INSERT INTO user_permission (email, level, role, school_codes, regions, read_only)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET
         level = EXCLUDED.level,
         role = EXCLUDED.role,
         school_codes = EXCLUDED.school_codes,
         regions = EXCLUDED.regions,
         read_only = EXCLUDED.read_only,
         updated_at = NOW()
       RETURNING id`,
      [email, level, userRole, school_codes || null, regions || null, read_only || false]
    );

    return NextResponse.json({ id: result[0].id, success: true });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
