import { NextResponse } from "next/server";
import { withBlendedLearning } from "@/lib/blended-learning-guard";
import { getJeeConfirmationUrl } from "@/lib/blended-learning-jee-form";

// The Mentee's current JEE form confirmation page: a redirect to a 5-minute
// presigned GET, for anyone who can see the Mentee (read-only included).
export const GET = withBlendedLearning("view_student", async (_request, { access, id }) => {
  let url: string | null;
  try {
    url = await getJeeConfirmationUrl(access, id);
  } catch (err) {
    // Never log the S3 key; the error name is enough to triage.
    console.error("JEE form confirmation presign failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ error: "Failed to load the confirmation page" }, { status: 502 });
  }
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "no-store" } });
});
