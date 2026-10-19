import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  requireCurriculumPlanAdmin,
  saveCurriculumPlanChapterDates,
} from "@/lib/curriculum-plans";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session, { forWrite: true });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await saveCurriculumPlanChapterDates({
    id: Number(id),
    adminEmail: access.email,
    body,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({ plan: result.plan, warnings: result.warnings });
}
