import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  createCentreOption,
  getCentreOptionSets,
  requireCentreAdmin,
  safeCentreApiError,
} from "@/lib/centres";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const result = await getCentreOptionSets();
  if (!result.ok) {
    return NextResponse.json(safeCentreApiError(result), { status: result.status });
  }

  return NextResponse.json({ optionSets: result.optionSets });
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

  const result = await createCentreOption({ body });
  if (!result.ok) {
    return NextResponse.json(safeCentreApiError(result), { status: result.status });
  }

  return NextResponse.json({ option: result.option });
}
