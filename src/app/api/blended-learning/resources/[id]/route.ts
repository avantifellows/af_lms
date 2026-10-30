import { NextResponse } from "next/server";
import { failureResponse, readJsonBody, withBlendedLearning } from "@/lib/blended-learning-guard";
import { deleteResource, updateResource } from "@/lib/blended-learning-resources";

// Edit a Resource's title and link, or remove it (`manage` only).
export const PATCH = withBlendedLearning("manage", async (request, { access, id }) => {
  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;
  const result = await updateResource(access, id, parsed.body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json(result.resource);
});

export const DELETE = withBlendedLearning("manage", async (_request, { access, id }) => {
  const result = await deleteResource(access, id);
  if (!result.ok) return failureResponse(result);
  return new NextResponse(null, { status: 204 });
});
