import { NextResponse } from "next/server";
import { requireBlendedLearning } from "@/lib/blended-learning-guard";
import { getConversationNotes } from "@/lib/blended-learning-mentee-detail";

// A past Conversation's full notes, fetched only when the Mentor expands them.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("view_student", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;
  const notes = await getConversationNotes(access, id);
  if (!notes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(notes, { headers: { "cache-control": "no-store" } });
}
