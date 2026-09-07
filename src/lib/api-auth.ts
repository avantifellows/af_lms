import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessSchool, getResolvedPermission } from "@/lib/permissions";
import { query } from "@/lib/db";

interface SchoolInfo {
  id: string;
  code: string;
  name: string;
  region: string | null;
}

type AuthResult =
  | {
      authorized: true;
      school: SchoolInfo;
      /**
       * True when the caller's `user_permission.read_only` flag is set. School
       * access says nothing about *changing* things — a read-only admin still
       * passes `canAccessSchool` — so routes that trigger work (report
       * generation, retries) pass `requireEdit`, and views consult this to
       * render the same verdict.
       */
      readOnly: boolean;
    }
  | { authorized: false; response: NextResponse };

// `requireEdit`: additionally refuse read-only callers with 403. Passcode
// users have no user_permission row and so cannot be read-only; the flag only
// bites for email users.
export async function authorizeSchoolAccess(
  udise: string,
  options?: { requireEdit?: boolean },
): Promise<AuthResult> {
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
    return { authorized: true, school, readOnly: false };
  }

  const email = session.user?.email || null;
  const hasAccess = await canAccessSchool(
    email,
    school.code,
    school.region || undefined
  );
  if (!hasAccess) {
    return {
      authorized: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    };
  }

  const permission = email ? await getResolvedPermission(email) : null;
  const readOnly = permission?.read_only === true;
  if (options?.requireEdit && readOnly) {
    return {
      authorized: false,
      response: NextResponse.json(
        { error: "Read-only access cannot perform this action" },
        { status: 403 },
      ),
    };
  }

  return { authorized: true, school, readOnly };
}
