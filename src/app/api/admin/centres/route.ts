import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { createCentre, getCentreList, requireCentreAdmin } from "@/lib/centres";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const result = await getCentreList({
    searchParams: Object.fromEntries(new URL(request.url).searchParams.entries()),
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({
    filters: result.filters,
    rows: result.rows,
    pagination: result.pagination,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const result = await createCentre({ body });

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({ centre: result.centre });
}
