import { NextResponse } from "next/server";
import { failureResponse, requireBlendedLearningJson } from "@/lib/blended-learning-guard";
import { createResource } from "@/lib/blended-learning-resources";

// Add a Resource (last on the list). Blended Learning Admins who may manage
// only; Mentors and read-only admins get 403.
export async function POST(request: Request) {
  const guarded = await requireBlendedLearningJson("manage", request);
  if (guarded instanceof NextResponse) return guarded;
  const result = await createResource(guarded.access, guarded.body);
  if (!result.ok) return failureResponse(result);
  return NextResponse.json(result.resource, { status: 201 });
}
