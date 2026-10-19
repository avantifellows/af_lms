import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { previewPlanAssignment } from "@/lib/curriculum-plan-assignments";
import { requireCurriculumPlanAdmin } from "@/lib/curriculum-plans";

// Preview a save by plan without writing: per ticked Centre its current plan, whether it
// moves, and uncovered tracks, plus the move count.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const result = await previewPlanAssignment({ id: Number(id), body });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({ preview: result.preview });
}
