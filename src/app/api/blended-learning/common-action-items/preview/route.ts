import { NextResponse } from "next/server";
import { failureResponse, requireBlendedLearning } from "@/lib/blended-learning-guard";
import { previewCommonTarget } from "@/lib/blended-learning-common-action-items";

// How many Students a target reaches now, before pushing:
// `?kind=all|grade|mentor&grade=12|13&mentorUserId=<id>` → `{ count }`
// (`manage` only).
export async function GET(request: Request) {
  const guard = await requireBlendedLearning("manage");
  if (guard instanceof NextResponse) return guard;
  const params = new URL(request.url).searchParams;
  const result = await previewCommonTarget(guard.access, {
    kind: params.get("kind"),
    grade: params.get("grade"),
    mentorUserId: params.get("mentorUserId"),
  });
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ count: result.count });
}
