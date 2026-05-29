import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessStudent } from "@/lib/permissions";
import {
  softDeleteDocument,
  DbServiceError,
} from "@/lib/db-service-documents";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const studentId = Number.parseInt(id, 10);
  const documentId = Number.parseInt(docId, 10);
  if (!Number.isFinite(studentId) || studentId <= 0) {
    return NextResponse.json({ error: "Invalid student id" }, { status: 400 });
  }
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  const allowed = await canAccessStudent(session, studentId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await softDeleteDocument(documentId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof DbServiceError) {
      if (err.status === 404) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      console.error("db-service softDeleteDocument failed:", err.status, err.body);
      return NextResponse.json(
        { error: "Failed to delete document" },
        { status: 502 },
      );
    }
    console.error("Unexpected error in DELETE document:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
