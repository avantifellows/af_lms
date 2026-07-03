import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireQuizSessionAccess } from "@/lib/quiz-session-access";

// On-demand PDF for a new-CMS test, so session details can offer question/answer PDFs the
// same way legacy sessions do — but generated fresh by the CMS rather than stored. Proxies
// the CMS service-PDF route (bearer-authed) and streams the bytes back. Nothing is stored;
// the PDF always reflects the current test. See task lms-cms-tests.
const CMS_SERVICE_URL = process.env.CMS_SERVICE_URL?.trim();
const CMS_SERVICE_TOKEN = process.env.CMS_SERVICE_TOKEN?.trim();

// Only the two variants we surface (legacy showed Question + Solution): the question paper
// and the answer key. The CMS also supports questions_with_answers, not exposed here.
const PDF_TYPES = ["questions", "answers"];

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireQuizSessionAccess(session.user.email, "view");
  if (!access.ok) {
    return access.response;
  }

  if (!CMS_SERVICE_URL || !CMS_SERVICE_TOKEN) {
    return NextResponse.json(
      { error: "CMS service is not configured" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const testId = (searchParams.get("testId") || "").trim();
  const curriculumId = (searchParams.get("curriculumId") || "").trim();
  const gradeId = (searchParams.get("gradeId") || "").trim();
  const type = (searchParams.get("type") || "questions").trim();
  const download = (searchParams.get("download") || "").trim() === "1";

  if (!testId) {
    return NextResponse.json({ error: "testId is required" }, { status: 400 });
  }
  if (!curriculumId || !gradeId) {
    return NextResponse.json(
      { error: "curriculumId and gradeId are required" },
      { status: 400 }
    );
  }
  if (!PDF_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  const cmsUrl =
    `${CMS_SERVICE_URL.replace(/\/$/, "")}/api/service/test-pdf` +
    `?id=${encodeURIComponent(testId)}` +
    `&curriculum_id=${encodeURIComponent(curriculumId)}` +
    `&grade_id=${encodeURIComponent(gradeId)}` +
    `&type=${encodeURIComponent(type)}`;

  let response: Response;
  try {
    response = await fetch(cmsUrl, {
      headers: { Authorization: `Bearer ${CMS_SERVICE_TOKEN}` },
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

  // Stream the PDF straight through, preserving the CMS-supplied filename. With
  // download=1, force an attachment so the browser saves instead of rendering inline.
  const body = await response.arrayBuffer();
  let disposition =
    response.headers.get("content-disposition") ?? `inline; filename="test.pdf"`;
  if (download) {
    disposition = disposition.replace(/^inline/i, "attachment");
    if (!/^attachment/i.test(disposition)) {
      disposition = `attachment; ${disposition.replace(/^[^;]*;\s*/, "")}`;
    }
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": disposition,
    },
  });
}
