import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getSubjectOptions, requireStaffAdmin } from "@/lib/staff-admin";

// Subject list for the staff-management create-teacher dropdown (admin only).
export async function GET() {
  const session = await getServerSession(authOptions);
  const access = await requireStaffAdmin(session);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const subjects = await getSubjectOptions();
  return NextResponse.json({ subjects });
}
