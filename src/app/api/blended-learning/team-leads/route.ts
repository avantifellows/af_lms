import { NextResponse } from "next/server";
import { failureResponse, requireBlendedLearningJson } from "@/lib/blended-learning-guard";
import { createTeamLeadLink } from "@/lib/blended-learning-team-leads";

// Make a Mentor a team lead of another Mentor this academic year (a running
// Supervision). Blended Learning Admins who may manage only; Mentors and
// read-only admins get 403. 422 for a bad pair, 409 when it already runs.
export async function POST(request: Request) {
  const guarded = await requireBlendedLearningJson("manage", request);
  if (guarded instanceof NextResponse) return guarded;
  const result = await createTeamLeadLink(guarded.access, guarded.body);
  if (!result.ok) return failureResponse(result);
  return new NextResponse(null, { status: 201 });
}
