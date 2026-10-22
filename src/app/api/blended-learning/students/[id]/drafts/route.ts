import { NextResponse } from "next/server";
import { failureResponse, readJsonBody, withBlendedLearning } from "@/lib/blended-learning-guard";
import { createDraft } from "@/lib/blended-learning-drafts";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

// Create a Conversation Draft from an uploaded Call Recording, with any
// session details already entered, and wake etl-next to transcribe it.
export const POST = withBlendedLearning("upload", async (request, { access, id }) => {
  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;

  const result = await createDraft(access, id, parsed.body, getTodayIST());
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ draftId: result.draftId, delivery: result.delivery }, { status: 201 });
});
