import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { discardDraft } from "@/lib/blended-learning-drafts";

// Discard an open Conversation Draft, so the Mentee can get a new upload or a
// hand-logged Conversation.
export const POST = withBlendedLearning("manage_draft", async (_request, { access, id }) => {
  const result = await discardDraft(access, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.draft);
});
