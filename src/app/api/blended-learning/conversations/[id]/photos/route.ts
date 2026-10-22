import { NextResponse } from "next/server";
import { requireBlendedLearning } from "@/lib/blended-learning-guard";
import { getConversationPhotos } from "@/lib/blended-learning-mentee-detail";

// A past Conversation's photos as short-lived presigned GETs.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("view_student", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;
  let photos;
  try {
    photos = await getConversationPhotos(access, id);
  } catch (err) {
    // Never log the S3 key; the error name is enough to triage.
    console.error("Blended Learning photo presign failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to load photos" }, { status: 502 });
  }
  if (!photos) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(photos, { headers: { "cache-control": "no-store" } });
}
