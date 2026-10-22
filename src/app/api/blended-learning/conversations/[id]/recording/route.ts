import { NextResponse } from "next/server";
import { requireBlendedLearning } from "@/lib/blended-learning-guard";
import { getRecordingPlayback } from "@/lib/blended-learning-mentee-detail";

// A saved Conversation's Call Recording for Blended Learning Admins only
// (ADR 0010): a 5-minute presigned GET, or { expired: true } once S3's
// lifecycle rule has removed it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("play_recording", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;
  let playback;
  try {
    playback = await getRecordingPlayback(access, id);
  } catch (err) {
    // Never log the S3 key; the error name is enough to triage.
    console.error("Blended Learning recording presign failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to load the recording" }, { status: 502 });
  }
  if (!playback) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(playback, { headers: { "cache-control": "no-store" } });
}
