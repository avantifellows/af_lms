import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { issueRecordingUpload } from "@/lib/blended-learning-drafts";

// Issue a presigned PUT for one Call Recording. The browser uploads straight
// to S3, then creates the Conversation Draft with the returned s3Key.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, "upload")) {
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

  const result = await issueRecordingUpload(access, Number(id), body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.upload);
}
