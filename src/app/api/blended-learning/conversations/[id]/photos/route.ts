import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { getConversationPhotos } from "@/lib/blended-learning-mentee-detail";

// A past Conversation's photos as short-lived presigned GETs.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "view_student")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  let photos;
  try {
    photos = /^\d+$/.test(id) ? await getConversationPhotos(access, Number(id)) : null;
  } catch (err) {
    // Never log the S3 key; the error name is enough to triage.
    console.error("Blended Learning photo presign failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to load photos" }, { status: 502 });
  }
  if (!photos) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(photos, { headers: { "cache-control": "no-store" } });
}
