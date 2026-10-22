import { NextResponse } from "next/server";
import { requireBlendedLearning } from "@/lib/blended-learning-guard";
import { getDraftStatus } from "@/lib/blended-learning-drafts";

// One Conversation Draft's state and whether "Retry drafting" is offered.
// The Mentee detail page polls this every 15 seconds while drafting.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("view_student", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;
  const draft = await getDraftStatus(access, id);
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(draft);
}
