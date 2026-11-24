import { NextResponse } from "next/server";
import { failureResponse, readJsonBody, withBlendedLearning } from "@/lib/blended-learning-guard";
import { moveResource } from "@/lib/blended-learning-resources";

// Move a Resource one place `{ direction: "up" | "down" }` (`manage` only).
export const POST = withBlendedLearning("manage", async (request, { access, id }) => {
  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;
  const result = await moveResource(access, id, parsed.body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ ok: true });
});
