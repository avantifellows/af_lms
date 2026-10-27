import { NextResponse } from "next/server";
import { failureResponse, requireBlendedLearningJson } from "@/lib/blended-learning-guard";
import { createCommonActionItem } from "@/lib/blended-learning-common-action-items";

// Save a Common Action Item and push it to its target's Students, as one
// open Action Item each (`manage` only). 201 `{ id, added }`.
export async function POST(request: Request) {
  const guarded = await requireBlendedLearningJson("manage", request);
  if (guarded instanceof NextResponse) return guarded;
  const result = await createCommonActionItem(guarded.access, guarded.body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ id: result.id, added: result.added }, { status: 201 });
}
