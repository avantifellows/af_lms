import { NextResponse } from "next/server";
import { failureResponse, readJsonBody, requireBlendedLearning } from "@/lib/blended-learning-guard";
import { logEntry } from "@/lib/blended-learning-log-entry";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

// Log a Conversation or an Attempt for one Mentee. A Mentor logs for their
// own Mentees; a Blended Learning Admin logs on the mapped Mentor's behalf.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("log", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;

  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;

  const result = await logEntry(access, id, parsed.body, getTodayIST());
  if (!result.ok) return failureResponse(result);
  return NextResponse.json({ entry: result.entry, mentee: result.mentee }, { status: 201 });
}
