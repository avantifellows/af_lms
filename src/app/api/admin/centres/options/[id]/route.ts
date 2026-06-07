import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  requireCentreAdmin,
  safeCentreApiError,
  updateCentreOption,
} from "@/lib/centres";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);

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

  const result = await updateCentreOption({
    id: Number(id),
    body,
  });

  if (!result.ok) {
    return NextResponse.json(safeCentreApiError(result), { status: result.status });
  }

  return NextResponse.json({ option: result.option });
}
