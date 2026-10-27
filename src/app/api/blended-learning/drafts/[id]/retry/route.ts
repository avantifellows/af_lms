import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { retryDrafting } from "@/lib/blended-learning-drafts";

// "Retry drafting" for a Conversation Draft that is stuck or failed. Answers
// with the draft's new state.
export const POST = withBlendedLearning("manage_draft", async (_request, { access, id }) => {
  const result = await retryDrafting(access, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.draft);
});
