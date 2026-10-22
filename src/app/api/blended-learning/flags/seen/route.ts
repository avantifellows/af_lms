import { NextResponse } from "next/server";
import { requireBlendedLearning } from "@/lib/blended-learning-guard";
import { recordFlagsSeen } from "@/lib/blended-learning-flags";

// Record the viewer's visit to the Flags tab, so "N new" clears next time.
// The tab calls this after rendering. Read-only admins may call it.
export async function POST() {
  const guard = await requireBlendedLearning("view_flags");
  if (guard instanceof NextResponse) return guard;
  const { access } = guard;
  const seen = await recordFlagsSeen(access);
  return NextResponse.json(seen);
}
