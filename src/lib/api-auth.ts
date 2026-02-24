import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessSchool } from "@/lib/permissions";
import { query } from "@/lib/db";

interface SchoolInfo {
  id: string;
  code: string;
  name: string;
  region: string | null;
}

type AuthResult =
  | { authorized: true; school: SchoolInfo }
  | { authorized: false; response: NextResponse };

export async function authorizeSchoolAccess(udise: string): Promise<AuthResult> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const schools = await query<SchoolInfo>(
    `SELECT id, code, name, region FROM school WHERE udise_code = $1 OR code = $1`,
    [udise]
  );
  const school = schools[0];
  if (!school) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "School not found" }, { status: 404 }),
    };
  }

  if (session.isPasscodeUser) {
    if (session.schoolCode !== school.code) {
      return {
        authorized: false,
        response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
      };
    }
  } else {
    const hasAccess = await canAccessSchool(
      session.user?.email || null,
      school.code,
      school.region || undefined
    );
    if (!hasAccess) {
      return {
        authorized: false,
        response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
      };
    }
  }

  return { authorized: true, school };
}
