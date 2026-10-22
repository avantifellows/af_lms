import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { recordFlagsSeen } from "@/lib/blended-learning-flags";

// Record the viewer's visit to the Flags tab, so "N new" clears next time.
// The tab calls this after rendering. Read-only admins may call it.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "view_flags")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const seen = await recordFlagsSeen(access);
  return NextResponse.json(seen);
}
