import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { getDraftStatus } from "@/lib/blended-learning-drafts";

// One Conversation Draft's state and whether "Retry drafting" is offered.
// The Mentee detail page polls this every 15 seconds while drafting.
export const GET = withBlendedLearning("view_student", async (_request, { access, id }) => {
  const draft = await getDraftStatus(access, id);
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(draft);
});
