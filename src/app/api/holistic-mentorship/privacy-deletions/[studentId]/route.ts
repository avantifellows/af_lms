import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

type RouteContext = { params: Promise<{ studentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  void request;
  void context;
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "privacy_delete");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
