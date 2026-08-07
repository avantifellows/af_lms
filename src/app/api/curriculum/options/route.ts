import { NextRequest, NextResponse } from "next/server";
import { requireCurriculumRequestAccess } from "@/lib/curriculum-api";
import { getCurriculumOptions } from "@/lib/curriculum-options";

export async function GET(request: NextRequest) {
  const access = await requireCurriculumRequestAccess("view");
  if (!access.ok) return access.response;

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim() || "";
  if (!schoolCode) {
    return NextResponse.json({ error: "school_code is required" }, { status: 400 });
  }

  const rawProgramId = request.nextUrl.searchParams.get("program_id");
  const programIdOverride = rawProgramId ? Number.parseInt(rawProgramId, 10) : null;

  const result = await getCurriculumOptions({
    schoolCode,
    programIdOverride: Number.isFinite(programIdOverride) ? programIdOverride : null,
    permission: access.permission,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    programs: result.programs,
    examTracks: result.examTracks,
    centreExamTracks: result.centreExamTracks,
    gradeSubjects: result.gradeSubjects,
    configurationError: result.configurationError,
    defaults: result.defaults,
  });
}
