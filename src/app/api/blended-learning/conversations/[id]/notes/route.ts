import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { getConversationNotes } from "@/lib/blended-learning-mentee-detail";

// A past Conversation's full notes, fetched only when the Mentor expands them.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "view_student")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const notes = /^\d+$/.test(id) ? await getConversationNotes(access, Number(id)) : null;
  if (!notes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(notes, { headers: { "cache-control": "no-store" } });
}
