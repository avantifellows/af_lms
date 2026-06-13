import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getStaffRoster,
  requireStaffAdmin,
  safeStaffApiError,
} from "@/lib/staff-admin";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireStaffAdmin(session);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchParams = Object.fromEntries(
    request.nextUrl.searchParams.entries()
  );
  const result = await getStaffRoster({ searchParams });
  if (!result.ok) {
    return NextResponse.json(safeStaffApiError(result), {
      status: result.status,
    });
  }

  return NextResponse.json({
    filters: result.filters,
    rows: result.rows,
    summary: result.summary,
  });
}
