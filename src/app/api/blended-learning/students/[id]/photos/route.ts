import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { uploadConversationPhoto } from "@/lib/blended-learning-photos";

// Upload one downscaled photo for a Mentee's next Conversation. The response's
// s3Key goes into the entries request's photoKeys[].
export const POST = withBlendedLearning("upload", async (request, { access, id }) => {
  let photo: FormDataEntryValue | null;
  try {
    photo = (await request.formData()).get("photo");
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }
  // Duck-typed: `instanceof Blob` breaks across realms.
  if (!photo || typeof photo === "string" || typeof (photo as Blob).arrayBuffer !== "function") {
    return NextResponse.json({ error: "Choose a photo." }, { status: 422 });
  }

  let result;
  try {
    result = await uploadConversationPhoto(access, id, photo as Blob);
  } catch (err) {
    // Never log the S3 key; the error name is enough to triage.
    console.error("Blended Learning photo upload failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Couldn't upload the photo. Try again." }, { status: 502 });
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.photo, { status: 201 });
});
