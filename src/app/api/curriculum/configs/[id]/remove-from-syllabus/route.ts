import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  removeCurriculumConfigRowFromSyllabus,
  requireCurriculumConfigAdmin,
} from "@/lib/curriculum-config";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumConfigAdmin(session);

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

  const result = await removeCurriculumConfigRowFromSyllabus({
    id: Number.parseInt(id, 10),
    adminEmail: access.email,
    body,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({
    row: result.row,
    warnings: result.warnings,
    impact: result.impact,
  });
}
