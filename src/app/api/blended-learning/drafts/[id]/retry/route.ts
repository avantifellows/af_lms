import { NextResponse } from "next/server";
import { requireBlendedLearning } from "@/lib/blended-learning-guard";
import { retryDrafting } from "@/lib/blended-learning-drafts";

// "Retry drafting" for a Conversation Draft that is stuck or failed. Answers
// with the draft's new state and how the wake call went.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("manage_draft", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;

  const result = await retryDrafting(access, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ...result.draft, delivery: result.delivery });
}
