import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { createDraft } from "@/lib/blended-learning-drafts";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

// Create a Conversation Draft from an uploaded Call Recording, with any
// session details already entered, and wake etl-next to transcribe it.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "upload")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }

  const result = await createDraft(access, Number(id), body, getTodayIST());
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) },
      { status: result.status }
    );
  }
  return NextResponse.json({ draftId: result.draftId, delivery: result.delivery }, { status: 201 });
}
