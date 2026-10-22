import { NextResponse } from "next/server";
import { requireBlendedLearning } from "@/lib/blended-learning-guard";
import { discardDraft } from "@/lib/blended-learning-drafts";

// Discard an open Conversation Draft, so the Mentee can get a new upload or a
// hand-logged Conversation.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("manage_draft", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;

  const result = await discardDraft(access, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.draft);
}
