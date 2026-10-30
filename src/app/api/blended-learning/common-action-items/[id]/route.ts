import { NextResponse } from "next/server";
import { failureResponse, readJsonBody, withBlendedLearning } from "@/lib/blended-learning-guard";
import { removeCommonActionItem, updateCommonActionItem } from "@/lib/blended-learning-common-action-items";

// Edit a Common Action Item's text and owner (its still-open Action Items
// follow), or remove it (its still-open Action Items are deleted, done ones
// kept). `manage` only.
export const PATCH = withBlendedLearning("manage", async (request, { access, id }) => {
  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;
  const result = await updateCommonActionItem(access, id, parsed.body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ updatedOpen: result.updatedOpen });
});

export const DELETE = withBlendedLearning("manage", async (_request, { access, id }) => {
  const result = await removeCommonActionItem(access, id);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ deletedOpen: result.deletedOpen });
});
