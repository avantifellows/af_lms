import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  createCurriculumConfigRow,
  getCurriculumConfigList,
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
  const result = await getCurriculumConfigList(params);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({
    filters: result.activeFilters,
    filterOptions: result.filterOptions,
    rows: result.rows,
    pagination: {
      page: result.currentPage,
      limit: result.limit,
      totalRows: result.totalRowCount,
      totalPages: result.totalPages,
    },
    sort: {
      sort: result.sort,
      dir: result.dir,
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumConfigAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await createCurriculumConfigRow({
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
