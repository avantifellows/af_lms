import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getCurriculumConfigExport,
  normalizeCurriculumConfigListParams,
  requireCurriculumConfigAdmin,
} from "@/lib/curriculum-config";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumConfigAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const params = normalizeCurriculumConfigListParams(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  const result = await getCurriculumConfigExport(params);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
