import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { getRecordingPlayback } from "@/lib/blended-learning-mentee-detail";

// A saved Conversation's Call Recording for Blended Learning Admins only
// (ADR 0010): a 5-minute presigned GET, or { expired: true } once S3's
// lifecycle rule has removed it.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "play_recording")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let playback;
  try {
    playback = /^\d+$/.test(id) ? await getRecordingPlayback(access, Number(id)) : null;
  } catch (err) {
    // Never log the S3 key; the error name is enough to triage.
    console.error("Blended Learning recording presign failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to load the recording" }, { status: 502 });
  }
  if (!playback) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(playback, { headers: { "cache-control": "no-store" } });
}
