import { NextResponse } from "next/server";
import { failureResponse, withBlendedLearning } from "@/lib/blended-learning-guard";
import { pushCommonActionItem } from "@/lib/blended-learning-common-action-items";

// Push again: add the Common Action Item to targeted Students who don't have
// it yet (`manage` only). `{ added }`.
export const POST = withBlendedLearning("manage", async (_request, { access, id }) => {
  const result = await pushCommonActionItem(access, id);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ added: result.added });
});
