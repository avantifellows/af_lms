import { NextResponse } from "next/server";
import { failureResponse, readJsonBody, withBlendedLearning } from "@/lib/blended-learning-guard";
import { logEntry } from "@/lib/blended-learning-log-entry";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

// Log a Conversation or an Attempt for one Mentee. Only a Mentor logs, for
// their own Mentees; Blended Learning Admins are view only (403).
export const POST = withBlendedLearning("log", async (request, { access, id }) => {
  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;

  const result = await logEntry(access, id, parsed.body, getTodayIST());
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ entry: result.entry, mentee: result.mentee }, { status: 201 });
});
