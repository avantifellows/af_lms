import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  requireStaffAdmin,
  safeStaffApiError,
  updateStaffName,
} from "@/lib/staff-admin";

// Update a roster person's display name. Writes the `user` table (first/last)
// and mirrors it to user_permission.full_name so the name is consistent across
// Staff Management, the Users screen, and login. See updateStaffName.
export async function PATCH(request: NextRequest) {
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

  const result = await updateStaffName({
    body: (body ?? {}) as Record<string, unknown>,
  });
  if (!result.ok) {
    return NextResponse.json(safeStaffApiError(result), {
      status: result.status,
    });
  }

  return NextResponse.json({ ok: true });
}
