import { NextRequest, NextResponse } from "next/server";
import { CENTRE_ASSIGNMENTS_SUBQUERY } from "@/lib/centres";
import { query } from "@/lib/db";
import { isUserRole, type UserRole } from "@/lib/permissions";
import { requireAdminApiAccess } from "../route-helpers";

// Disable Next.js caching for this route
export const dynamic = "force-dynamic";

type UserWrite = {
  email: string;
  level: number;
  role?: string;
  school_codes?: string[] | null;
  regions?: string[] | null;
  program_ids?: number[] | null;
  read_only?: boolean;
  full_name?: string | null;
};

function userRole(value: UserWrite): UserRole {
  return isUserRole(value.role) ? value.role : "teacher";
}

function validateUserWrite(value: UserWrite): string | null {
  if (!value.email) return "Email and level are required";
  if (!value.level) return "Email and level are required";
  if (value.level < 1) return "Level must be between 1 and 3";
  if (value.level > 3) return "Level must be between 1 and 3";
  if (value.role !== undefined && !isUserRole(value.role)) return "Invalid role";
  if (userRole(value) === "holistic_mentorship_admin") return null;
  if (!Array.isArray(value.program_ids)) return "At least one program must be assigned";
  if (value.program_ids.length === 0) return "At least one program must be assigned";
  return null;
}

function userWriteParams(value: UserWrite) {
  const role = userRole(value);
  const holisticAdmin = role === "holistic_mentorship_admin";
  const scope = holisticAdmin
    ? { level: 3, schoolCodes: null, regions: null, programIds: [1] }
    : {
        level: value.level,
        schoolCodes: value.school_codes || null,
        regions: value.regions || null,
        programIds: value.program_ids,
      };
  return [
    value.email,
    scope.level,
    role,
    scope.schoolCodes,
    scope.regions,
    scope.programIds,
    value.read_only || false,
    value.full_name || null,
  ];
}

// GET /api/admin/users - List all users
export async function GET() {
  const access = await requireAdminApiAccess();
  if (!access.ok) return access.response;

  const users = await query<{
    id: number;
    email: string;
    level: number;
    role: string;
    school_codes: string[] | null;
    regions: string[] | null;
    program_ids: number[] | null;
    read_only: boolean;
    full_name: string | null;
    centres: { centreName: string; role: string }[];
    inserted_at: string;
    updated_at: string;
  }>(
    `SELECT id, email, level, role, school_codes, regions, program_ids, read_only, full_name,
            ${CENTRE_ASSIGNMENTS_SUBQUERY},
            inserted_at, updated_at
     FROM user_permission
     ORDER BY level DESC, role, email`
  );

  return NextResponse.json(users);
}

// POST /api/admin/users - Create new user
export async function POST(request: NextRequest) {
  const access = await requireAdminApiAccess();
  if (!access.ok) return access.response;

  try {
    const body = await request.json() as UserWrite;
    const validationError = validateUserWrite(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const result = await query<{ id: number }>(
      `INSERT INTO user_permission (email, level, role, school_codes, regions, program_ids, read_only, full_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (email) DO UPDATE SET
         level = EXCLUDED.level,
         role = EXCLUDED.role,
         school_codes = EXCLUDED.school_codes,
         regions = EXCLUDED.regions,
         program_ids = EXCLUDED.program_ids,
         read_only = EXCLUDED.read_only,
         full_name = EXCLUDED.full_name,
         updated_at = NOW()
       RETURNING id`,
      userWriteParams(body)
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
