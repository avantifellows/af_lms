import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessSchool } from "@/lib/permissions";
import { query } from "@/lib/db";
import { getSchoolQuizSessions } from "@/lib/bigquery";

interface School {
  code: string;
  region: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ udise: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { udise } = await params;

  const schools = await query<School>(
    `SELECT code, region FROM school WHERE udise_code = $1 OR code = $1`,
    [udise]
  );
  const school = schools[0];
  if (!school) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  const isPasscodeUser = session.isPasscodeUser;
  if (isPasscodeUser) {
    if (session.schoolCode !== school.code) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  } else {
    const hasAccess = await canAccessSchool(
      session.user?.email || null,
      school.code,
      school.region || undefined
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
  }

  const sessions = await getSchoolQuizSessions(udise);
  return NextResponse.json({ sessions });
}
