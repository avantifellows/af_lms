import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface PageUpload {
  buffer: Buffer;
  mimeType: string;
  pageNumber: number;
}

export interface UploadedPage {
  s3_key: string;
  page_number: number;
  mime_type: string;
  byte_size: number;
}

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export function extensionFor(mimeType: string): string {
  const ext = MIME_TO_EXTENSION[mimeType];
  if (!ext) throw new Error(`No extension mapping for MIME type: ${mimeType}`);
  return ext;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: process.env.S3_DOCS_REGION || "ap-south-1",
      credentials: {
        accessKeyId: process.env.S3_DOCS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_DOCS_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _client;
}

// Test-only hook: clear the cached client so a new one picks up updated env vars.
export function __resetS3ClientForTesting(): void {
  _client = null;
}

function bucket(): string {
  const b = process.env.S3_DOCS_BUCKET;
  if (!b) throw new Error("S3_DOCS_BUCKET is not set");
  return b;
}

function prefix(): string {
  const p = process.env.S3_DOCS_PREFIX;
  if (!p) throw new Error("S3_DOCS_PREFIX is not set");
  return p;
}

export function buildKey(opts: {
  studentId: number;
  documentType: string;
  documentUuid: string;
  pageNumber: number;
  extension: string;
}): string {
  return `${prefix()}/students/${opts.studentId}/${opts.documentType}/${opts.documentUuid}/page-${opts.pageNumber}.${opts.extension}`;
}

// Thrown when uploadDocumentPages fails partway through. `uploaded` holds the
// keys that succeeded before the failure so the caller can clean them up.
export class S3UploadError extends Error {
  readonly uploaded: UploadedPage[];
  override readonly cause: unknown;
  constructor(message: string, uploaded: UploadedPage[], cause: unknown) {
    super(message);
    this.name = "S3UploadError";
    this.uploaded = uploaded;
    this.cause = cause;
  }
}

export async function uploadDocumentPages(opts: {
  studentId: number;
  documentType: string;
  documentUuid: string;
  pages: PageUpload[];
}): Promise<UploadedPage[]> {
  const uploaded: UploadedPage[] = [];
  const c = client();
  const b = bucket();

  // Sequential PUTs (not Promise.all) so the failure point is deterministic
  // and `uploaded` accurately reflects what's actually in S3.
  for (const page of opts.pages) {
    const extension = extensionFor(page.mimeType);
    const s3_key = buildKey({
      studentId: opts.studentId,
      documentType: opts.documentType,
      documentUuid: opts.documentUuid,
      pageNumber: page.pageNumber,
      extension,
    });
    try {
      await c.send(
        new PutObjectCommand({
          Bucket: b,
          Key: s3_key,
          Body: page.buffer,
          ContentType: page.mimeType,
        }),
      );
    } catch (err) {
      throw new S3UploadError(
        `Failed to upload page ${page.pageNumber} (${s3_key})`,
        uploaded,
        err,
      );
    }
    uploaded.push({
      s3_key,
      page_number: page.pageNumber,
      mime_type: page.mimeType,
      byte_size: page.buffer.byteLength,
    });
  }
  return uploaded;
}

// Sign a short-lived GET URL for a single S3 key. Used by the viewer route
// to hand the browser a direct link without proxying bytes through Lambda.
export async function presignDocumentPage(opts: {
  s3Key: string;
  ttlSeconds: number;
  responseContentType?: string;
}): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: opts.s3Key,
      ...(opts.responseContentType
        ? { ResponseContentType: opts.responseContentType }
        : {}),
    }),
    { expiresIn: opts.ttlSeconds },
  );
}

// Best-effort cleanup. Never throws; logs individual failures so a leaked
// object doesn't block the overall response path.
export async function deleteDocumentObjects(s3Keys: string[]): Promise<void> {
  const c = client();
  const b = bucket();
  for (const key of s3Keys) {
    try {
      await c.send(new DeleteObjectCommand({ Bucket: b, Key: key }));
    } catch (err) {
      console.error(`S3 delete failed for key ${key}:`, err);
    }
  }
}
