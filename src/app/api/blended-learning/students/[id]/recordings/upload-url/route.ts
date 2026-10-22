import { NextResponse } from "next/server";
import { readJsonBody, requireBlendedLearning } from "@/lib/blended-learning-guard";
import { issueRecordingUpload } from "@/lib/blended-learning-drafts";

// Issue a presigned PUT for one Call Recording. The browser uploads straight
// to S3, then creates the Conversation Draft with the returned s3Key.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireBlendedLearning("upload", params);
  if (guard instanceof NextResponse) return guard;
  const { access, id } = guard;

  const parsed = await readJsonBody(request);
  if (parsed instanceof NextResponse) return parsed;

  const result = await issueRecordingUpload(access, id, parsed.body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.upload);
}
