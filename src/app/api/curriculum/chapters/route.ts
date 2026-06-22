import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkCurriculumSchema } from "@/lib/curriculum-schema";
import { getCurriculumChapters } from "@/lib/curriculum-options";
import { getFeatureAccess, getResolvedPermission } from "@/lib/permissions";

type CurriculumSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

async function requireCurriculumViewAccess(session: CurriculumSession) {
  if (!session?.user?.email) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.isPasscodeUser) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const permission = await getResolvedPermission(session.user.email);
  const access = getFeatureAccess(permission, "curriculum");
  if (!permission || !access.canView) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, permission };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumViewAccess(session);
  if (!access.ok) return access.response;

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return NextResponse.json(schema, { status: schema.status });
  }

  const searchParams = request.nextUrl.searchParams;
  const schoolCode = searchParams.get("school_code")?.trim() || "";
  const programId = Number.parseInt(searchParams.get("program_id") || "", 10);
  const examTrack = searchParams.get("exam_track")?.trim() || "";
  const grade = Number.parseInt(searchParams.get("grade") || "", 10);
  const subject = searchParams.get("subject")?.trim() || "";

  if (!schoolCode || !Number.isFinite(programId) || !examTrack || !Number.isFinite(grade) || !subject) {
    return NextResponse.json(
      { error: "school_code, program_id, exam_track, grade, and subject are required" },
      { status: 400 }
    );
  }

  const result = await getCurriculumChapters({
    schoolCode,
    programId,
    examTrack,
    grade,
    subject,
    permission: access.permission,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ chapters: result.chapters });
}
