import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireCmsServiceAccess } from "@/lib/cms-service";
import {
  buildTransientKey,
  presignDocumentPage,
  uploadTransientObject,
} from "@/lib/s3";

// On-demand PDF for a new-CMS test, so session details can offer question/answer PDFs the
// same way legacy sessions do — but generated fresh by the CMS rather than stored. Fetches
// the CMS service-PDF route (bearer-authed) and hands the bytes to the browser. The PDF
// always reflects the current test. See task lms-cms-tests.
//
// The bytes are NOT returned from this route. Amplify caps SSR responses at ~5.7MB and does
// not stream API routes, so a larger paper 504'd with no useful error. Instead the PDF is
// staged as a transient S3 object (lifecycle-expired after a day) and the browser is
// redirected to a short-lived presigned URL. Lambda's outbound side has no such cap.
//
// Only the two variants we surface (legacy showed Question + Solution): the question paper
// and the answer key. The CMS also supports questions_with_answers, not exposed here.
const PDF_TYPES = ["questions", "answers"];

// Long enough to survive a slow click-through, short enough that a leaked link is useless.
const PRESIGN_TTL_SECONDS = 300;

// fallow-ignore-next-line complexity
export async function GET(request: NextRequest) {
  const access = await requireCmsServiceAccess();
  if (!access.ok) {
    return access.response;
  }
  const { cms } = access;

  const { searchParams } = new URL(request.url);
  const testId = (searchParams.get("testId") || "").trim();
  const type = (searchParams.get("type") || "questions").trim();
  const download = (searchParams.get("download") || "").trim() === "1";

  if (!testId) {
    return NextResponse.json({ error: "testId is required" }, { status: 400 });
  }
  if (!PDF_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  // The CMS resolves a test by id alone (nex-gen-cms#177).
  const cmsUrl =
    `${cms.url}/api/service/test-pdf` +
    `?id=${encodeURIComponent(testId)}` +
    `&type=${encodeURIComponent(type)}`;

  let response: Response;
  try {
    response = await fetch(cmsUrl, {
      headers: { Authorization: `Bearer ${cms.token}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("Failed to reach CMS PDF service:", err);
    return NextResponse.json({ error: "Failed to reach CMS" }, { status: 502 });
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("CMS PDF generation failed:", response.status, errorText);
    return NextResponse.json(
      { error: "Failed to generate PDF" },
      { status: response.status }
    );
  }

  // Preserve the CMS-supplied filename. With download=1, force an attachment so the
  // browser saves instead of rendering inline. The disposition rides on the presigned URL
  // (response-content-disposition) because <a download> is ignored cross-origin.
  const body = Buffer.from(await response.arrayBuffer());
  let disposition =
    response.headers.get("content-disposition") ?? `inline; filename="test.pdf"`;
  if (download) {
    disposition = disposition.replace(/^inline/i, "attachment");
    if (!/^attachment/i.test(disposition)) {
      disposition = `attachment; ${disposition.replace(/^[^;]*;\s*/, "")}`;
    }
  }

  const s3Key = buildTransientKey({
    kind: "cms-test-pdf",
    id: randomUUID(),
    extension: "pdf",
  });
  let signedUrl: string;
  try {
    await uploadTransientObject({
      s3Key,
      body,
      contentType: "application/pdf",
    });
    signedUrl = await presignDocumentPage({
      s3Key,
      ttlSeconds: PRESIGN_TTL_SECONDS,
      responseContentType: "application/pdf",
      responseContentDisposition: disposition,
    });
  } catch (err) {
    console.error("Failed to stage CMS PDF in S3:", err);
    return NextResponse.json({ error: "Failed to stage PDF" }, { status: 502 });
  }

  // 302 (not 307) so the redirect is a plain GET regardless of how it was reached, and
  // no-store so nothing caches a URL that dies in five minutes.
  const redirect = NextResponse.redirect(signedUrl, 302);
  redirect.headers.set("Cache-Control", "no-store");
  return redirect;
}
