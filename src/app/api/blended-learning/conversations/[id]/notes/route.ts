import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { getConversationNotes } from "@/lib/blended-learning-mentee-detail";

// A past Conversation's full notes, fetched only when the Mentor expands them.
export const GET = withBlendedLearning("view_student", async (_request, { access, id }) => {
  const notes = await getConversationNotes(access, id);
  if (!notes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(notes, { headers: { "cache-control": "no-store" } });
});
