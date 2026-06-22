import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  createPosition,
  requireStaffAdmin,
  safeStaffApiError,
} from "@/lib/staff-admin";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireStaffAdmin(session);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await createPosition({
    body: (body ?? {}) as Record<string, unknown>,
  });
  if (!result.ok) {
    return NextResponse.json(safeStaffApiError(result), {
      status: result.status,
    });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
