import { NextResponse } from "next/server";
import { failureResponse, withBlendedLearning } from "@/lib/blended-learning-guard";
import { endTeamLeadLink } from "@/lib/blended-learning-team-leads";

// End a running Supervision (`manage` only): the team lead no longer sees
// that Mentor's Students. The row stays, ended. 404 when none runs.
export const POST = withBlendedLearning("manage", async (_request, { access, id }) => {
  const result = await endTeamLeadLink(access, id);
  if (!result.ok) return failureResponse(result);
  return new NextResponse(null, { status: 204 });
});
