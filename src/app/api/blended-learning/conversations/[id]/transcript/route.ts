import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { getTranscript } from "@/lib/blended-learning-mentee-detail";

// A saved Conversation's Call Recording transcript as speaker turns, for
// Blended Learning Admins only (ADR 0010). The transcript is never logged.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "play_recording")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let transcript;
  try {
    transcript = /^\d+$/.test(id) ? await getTranscript(access, Number(id)) : null;
  } catch (err) {
    // Never log the S3 key or the transcript; the error name is enough to triage.
    console.error("Blended Learning transcript read failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to load the transcript" }, { status: 502 });
  }
  if (!transcript) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(transcript, { headers: { "cache-control": "no-store" } });
}
