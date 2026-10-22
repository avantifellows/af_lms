import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { getDraftStatus } from "@/lib/blended-learning-drafts";

// One Conversation Draft's state and whether "Retry drafting" is offered.
// The Mentee detail page polls this every 15 seconds while drafting.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "view_student")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const draft = /^\d+$/.test(id) ? await getDraftStatus(access, Number(id)) : null;
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(draft);
}
