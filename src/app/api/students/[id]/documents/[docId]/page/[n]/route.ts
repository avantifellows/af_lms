import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessStudent } from "@/lib/permissions";
import { presignDocumentPage } from "@/lib/s3";
import { listDocuments, DbServiceError } from "@/lib/db-service-documents";

const PRESIGN_TTL_SECONDS = 600; // 10 minutes

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; docId: string; n: string }>;
  },
) {
  const { id, docId, n } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reject trailing junk (e.g. "5abc" silently coercing to 5).
  if (!/^\d+$/.test(id) || !/^\d+$/.test(docId) || !/^\d+$/.test(n)) {
    return NextResponse.json({ error: "Invalid id or page number" }, { status: 400 });
  }
  const studentId = Number.parseInt(id, 10);
  const documentId = Number.parseInt(docId, 10);
  const pageNumber = Number.parseInt(n, 10);
  if (!Number.isFinite(studentId) || studentId <= 0) {
    return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
  }
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
    return NextResponse.json({ error: "Invalid page number" }, { status: 400 });
  }

  const allowed = await canAccessStudent(session, studentId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let docs;
  try {
    docs = await listDocuments(studentId);
  } catch (err) {
    if (err instanceof DbServiceError) {
      console.error("db-service listDocuments failed:", err.status, err.body);
      return NextResponse.json(
        { error: "Failed to load document" },
        { status: 502 },
      );
    }
    console.error("Unexpected error loading documents:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const doc = docs.find((d) => d.id === documentId);
  if (!doc || doc.deleted_at) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const page = doc.pages?.find((p) => p.page_number === pageNumber);
  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  let presignedUrl: string;
  try {
    presignedUrl = await presignDocumentPage({
      s3Key: page.s3_key,
      ttlSeconds: PRESIGN_TTL_SECONDS,
      responseContentType: page.mime_type,
    });
  } catch (err) {
    console.error("Failed to presign S3 URL:", err);
    return NextResponse.json(
      { error: "Failed to generate view URL" },
      { status: 502 },
    );
  }

  // 302 redirect — browser follows directly to S3 without exposing our route
  // or proxying bytes through Lambda. Cache: no-store keeps a refresh from
  // re-using a URL that has expired.
  return NextResponse.redirect(presignedUrl, {
    status: 302,
    headers: { "cache-control": "no-store" },
  });
}
