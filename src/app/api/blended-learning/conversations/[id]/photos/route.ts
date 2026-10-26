import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { getConversationPhotos } from "@/lib/blended-learning-mentee-detail";

// A past Conversation's photos as short-lived presigned GETs.
export const GET = withBlendedLearning("view_student", async (_request, { access, id }) => {
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
});
