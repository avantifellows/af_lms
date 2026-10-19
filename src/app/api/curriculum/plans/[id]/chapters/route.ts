import { NextRequest, NextResponse } from "next/server";

import { saveCurriculumPlanChapterDates } from "@/lib/curriculum-plans";
import { handlePlanRoute } from "../../plan-route";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handlePlanRoute(
    { forWrite: true, request },
    async ({ email, body }) =>
      saveCurriculumPlanChapterDates({ id: Number((await params).id), adminEmail: email, body }),
    (result) => NextResponse.json({ plan: result.plan, warnings: result.warnings })
  );
}
