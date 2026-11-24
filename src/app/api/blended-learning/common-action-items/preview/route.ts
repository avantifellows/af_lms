import { NextResponse } from "next/server";
import { failureResponse, requireBlendedLearningJson } from "@/lib/blended-learning-guard";
import { previewCommonTarget } from "@/lib/blended-learning-common-action-items";

// How many Students a target reaches now, before pushing. A POST, since
// pasted Student IDs can be long: `{ kind, grade?, mentorUserId?,
// studentIds? }` → `{ count, notFound, noMentor }` (`manage` only; nothing is
// written).
export async function POST(request: Request) {
  const guarded = await requireBlendedLearningJson("manage", request);
  if (guarded instanceof NextResponse) return guarded;
  const result = await previewCommonTarget(guarded.access, guarded.body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ count: result.count, notFound: result.notFound, noMentor: result.noMentor });
}
