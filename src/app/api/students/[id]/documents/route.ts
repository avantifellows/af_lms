import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { randomUUID } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { canAccessStudent } from "@/lib/permissions";
import { isValidDocumentType } from "@/lib/document-types";
import {
  uploadDocumentPages,
  deleteDocumentObjects,
  S3UploadError,
  type PageUpload,
} from "@/lib/s3";
import {
  listDocuments,
  createDocument,
  DbServiceError,
} from "@/lib/db-service-documents";

const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB raw (pre-downscale)
const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024; //  5 MB
const MAX_PHOTOS = 10;

const ALLOWED_PHOTO_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

function parseStudentId(raw: string): number | null {
  // Require an exact integer match (`Number.parseInt` accepts trailing junk
  // like "5abc" → 5, which would silently route to the wrong student).
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function gateOrError(
  session: Session | null,
  studentIdRaw: string,
  options?: { requireEdit?: boolean },
): Promise<
  | { ok: true; studentId: number; session: Session }
  | { ok: false; response: NextResponse }
> {
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const studentId = parseStudentId(studentIdRaw);
  if (studentId === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid student id" }, { status: 400 }),
    };
  }
  const allowed = await canAccessStudent(session, studentId, options);
  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, studentId, session };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const gate = await gateOrError(session, id);
  if (!gate.ok) return gate.response;

  try {
    const docs = await listDocuments(gate.studentId);
    return NextResponse.json(docs);
  } catch (err) {
    if (err instanceof DbServiceError) {
      console.error("db-service listDocuments failed:", err.status, err.body);
      return NextResponse.json(
        { error: "Failed to load documents" },
        { status: 502 },
      );
    }
    console.error("Unexpected error in GET documents:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface CollectedFile {
  buffer: Buffer;
  mimeType: string;
  pageNumber: number;
  size: number;
}

// Walk `page_1`, `page_2`, ... in order; stop at the first missing index.
// Anything beyond a gap is ignored — clients should send contiguous page
// numbers starting at 1.
async function collectPageFiles(form: FormData): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  // Walk up to MAX_PHOTOS + 1 so that 11+ files in photos mode trip the
  // "too many pages" check downstream rather than being silently truncated.
  for (let i = 1; i <= MAX_PHOTOS + 1; i++) {
    const value = form.get(`page_${i}`);
    if (value === null) break;
    // FormData entries are either string or file-like. Use duck typing on
    // arrayBuffer() because `instanceof Blob` breaks across realms (jsdom Blob
    // ≠ undici File when the test environment is jsdom).
    if (typeof value === "string" || typeof (value as Blob).arrayBuffer !== "function") {
      throw new Error(`page_${i} is not a file`);
    }
    const blob = value as Blob;
    const arrayBuf = await blob.arrayBuffer();
    out.push({
      buffer: Buffer.from(arrayBuf),
      mimeType: blob.type || "application/octet-stream",
      pageNumber: i,
      size: blob.size,
    });
  }
  return out;
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  // POST is a write — require feature-level edit access on `students`. Without
  // this, a read-only program_admin could upload via direct API call even
  // though the UI hides the buttons.
  const gate = await gateOrError(session, id, { requireEdit: true });
  if (!gate.ok) return gate.response;
  const { studentId } = gate;

  // Parse multipart form
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("Failed to parse multipart body:", err);
    return badRequest("Invalid multipart body");
  }

  const documentType = form.get("document_type");
  if (typeof documentType !== "string" || !isValidDocumentType(documentType)) {
    return badRequest("Invalid or missing document_type");
  }

  let metadata: Record<string, unknown> = {};
  const metadataRaw = form.get("metadata");
  if (typeof metadataRaw === "string" && metadataRaw.length > 0) {
    try {
      const parsed = JSON.parse(metadataRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      } else {
        return badRequest("metadata must be a JSON object");
      }
    } catch {
      return badRequest("metadata is not valid JSON");
    }
  }

  let files: CollectedFile[];
  try {
    files = await collectPageFiles(form);
  } catch (err) {
    console.error("Failed to collect page files:", err);
    return badRequest("Invalid page upload");
  }

  if (files.length === 0) {
    return badRequest("At least one page is required");
  }

  const firstMime = files[0].mimeType;
  const isPdf = firstMime === "application/pdf";

  if (isPdf) {
    if (files.length !== 1) {
      return badRequest("PDF mode accepts exactly one file (page_1)");
    }
    if (files[0].size > MAX_PDF_SIZE_BYTES) {
      return badRequest(`PDF exceeds ${MAX_PDF_SIZE_BYTES} bytes`);
    }
  } else {
    if (files.length > MAX_PHOTOS) {
      return badRequest(`At most ${MAX_PHOTOS} pages allowed`);
    }
    for (const f of files) {
      if (!ALLOWED_PHOTO_MIMES.has(f.mimeType)) {
        return badRequest(`Unsupported MIME type: ${f.mimeType}`);
      }
      if (f.size > MAX_PHOTO_SIZE_BYTES) {
        return badRequest(`page_${f.pageNumber} exceeds ${MAX_PHOTO_SIZE_BYTES} bytes`);
      }
    }
  }

  const pages: PageUpload[] = files.map((f) => ({
    buffer: f.buffer,
    mimeType: f.mimeType,
    pageNumber: f.pageNumber,
  }));

  const documentUuid = randomUUID();
  const uploaderEmail = session?.user?.email || "unknown";

  // Upload pages to S3. On partial failure, clean up what we did upload.
  let uploaded;
  try {
    uploaded = await uploadDocumentPages({
      studentId,
      documentType,
      documentUuid,
      pages,
    });
  } catch (err) {
    if (err instanceof S3UploadError) {
      console.error("S3 upload partial failure:", err.message, err.cause);
      await deleteDocumentObjects(err.uploaded.map((p) => p.s3_key));
    } else {
      console.error("S3 upload unexpected error:", err);
    }
    return NextResponse.json(
      { error: "Failed to upload pages to storage" },
      { status: 502 },
    );
  }

  // Persist the row. If db-service rejects, clean up the S3 objects.
  try {
    const row = await createDocument({
      student_id: studentId,
      document_type: documentType,
      pages: uploaded,
      metadata,
      uploaded_by: uploaderEmail,
    });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    await deleteDocumentObjects(uploaded.map((p) => p.s3_key));
    if (err instanceof DbServiceError) {
      console.error("db-service createDocument failed:", err.status, err.body);
      return NextResponse.json(
        { error: "Failed to record document" },
        { status: 502 },
      );
    }
    console.error("Unexpected error in createDocument:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
