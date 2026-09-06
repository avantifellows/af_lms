import { NextRequest, NextResponse } from "next/server";
import { requireCurriculumScopeRequest } from "@/lib/curriculum-api";
import { getCurriculumChapters } from "@/lib/curriculum-options";

export async function GET(request: NextRequest) {
  const access = await requireCurriculumScopeRequest(request);
  if (!access.ok) return access.response;

  const result = await getCurriculumChapters({
    ...access.scope,
    permission: access.permission,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ chapters: result.chapters });
}
