import { NextResponse } from "next/server";
import { failureResponse, readJsonBody, withBlendedLearning } from "@/lib/blended-learning-guard";
import { tickLegacyActionItem } from "@/lib/blended-learning-legacy-action-items";

// Tick a Profile Doc action item done, or open again. Only the Student's own
// Mentor; Blended Learning Admins and other Mentors get 403, a list changed
// since the page loaded 409.
export const POST = withBlendedLearning("log", async (request, { access, id }) => {
  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;

  const result = await tickLegacyActionItem(access, id, parsed.body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ item: result.item });
});
