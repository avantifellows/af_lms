import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { getTranscript } from "@/lib/blended-learning-mentee-detail";

// A saved Conversation's Call Recording transcript as speaker turns, for
// Blended Learning Admins only (ADR 0010). The transcript is never logged.
export const GET = withBlendedLearning("play_recording", async (_request, { access, id }) => {
  let transcript;
  try {
    transcript = await getTranscript(access, id);
  } catch (err) {
    // Never log the S3 key or the transcript; the error name is enough to triage.
    console.error("Blended Learning transcript read failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to load the transcript" }, { status: 502 });
  }
  if (!transcript) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(transcript, { headers: { "cache-control": "no-store" } });
});
