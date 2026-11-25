// Reading and checking the pages of a multipart document upload. Shared by
// the Documents tab's upload (`/api/students/[id]/documents`) and the Exams
// tab's acknowledgement upload, so both accept exactly the same files.
//
// A document is either up to MAX_PHOTOS photos (`page_1`, `page_2`, ...) or a
// single PDF in `page_1`.

import type { PageUpload } from "@/lib/s3";

export const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB raw (pre-downscale)
export const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024; //  5 MB
export const MAX_PHOTOS = 10;

const ALLOWED_PHOTO_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

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

/** Why these pages can't be stored, or null if they can. */
function pagesError(files: CollectedFile[]): string | null {
  if (files.length === 0) return "At least one page is required";

  if (files[0].mimeType === "application/pdf") {
    if (files.length !== 1) return "PDF mode accepts exactly one file (page_1)";
    if (files[0].size > MAX_PDF_SIZE_BYTES) return `PDF exceeds ${MAX_PDF_SIZE_BYTES} bytes`;
    return null;
  }

  if (files.length > MAX_PHOTOS) return `At most ${MAX_PHOTOS} pages allowed`;
  for (const f of files) {
    if (!ALLOWED_PHOTO_MIMES.has(f.mimeType)) return `Unsupported MIME type: ${f.mimeType}`;
    if (f.size > MAX_PHOTO_SIZE_BYTES) {
      return `page_${f.pageNumber} exceeds ${MAX_PHOTO_SIZE_BYTES} bytes`;
    }
  }
  return null;
}

/**
 * The pages of an upload, ready for S3, or the 400 message explaining why they
 * were refused.
 */
export async function readDocumentPages(
  form: FormData,
): Promise<{ ok: true; pages: PageUpload[] } | { ok: false; error: string }> {
  let files: CollectedFile[];
  try {
    files = await collectPageFiles(form);
  } catch (err) {
    console.error("Failed to collect page files:", err);
    return { ok: false, error: "Invalid page upload" };
  }

  const error = pagesError(files);
  if (error) return { ok: false, error };

  return {
    ok: true,
    pages: files.map((f) => ({
      buffer: f.buffer,
      mimeType: f.mimeType,
      pageNumber: f.pageNumber,
    })),
  };
}
