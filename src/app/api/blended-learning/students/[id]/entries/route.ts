import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { logEntry } from "@/lib/blended-learning-log-entry";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

// Log a Conversation or an Attempt for one Mentee. A Mentor logs for their
// own Mentees; a Blended Learning Admin logs on the mapped Mentor's behalf.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "log")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }

  const result = await logEntry(access, Number(id), body, getTodayIST());
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) },
      { status: result.status }
    );
  }
  return NextResponse.json({ entry: result.entry, mentee: result.mentee }, { status: 201 });
}
