# LMS Document Uploads — Implementation Plan

_Drafted 2026-05-28. Decisions resolved 2026-05-29; implementation in progress._

## Goal

Let a teacher attach scanned/photographed documents (parent research-consent forms, ID proofs, bonafide certificates, etc.) to a student record on mobile. Uploads are atomic (all pages of a document succeed, or nothing is saved), multi-page-capable from day one, and survive prod→staging DB dumps because they share one S3 bucket.

Two upload modes:
- **Photos mode** — multi-page capture from the phone camera (1–10 image pages), downscaled client-side.
- **PDF mode** — single-file upload (existing already-scanned PDFs), no downscale.

## What's already done

- **db-service PR #514** (merged + deployed to staging): `lms_student_documents` table + REST API at `/api/lms-student-document` (index/create/show/delete-as-soft).
- **S3 infra** (live in AWS account `111766607077`, `ap-south-1`):
  - Bucket `avantifellows-documents` — versioning on, SSE-S3, all public access blocked, noncurrent versions expire after 90 days.
  - IAM user `af-lms-s3` with policy `af-lms-documents` scoped to `lms-documents/*` only. Smoke-tested PUT/GET/LIST/DELETE inside the prefix work; writes outside return `AccessDenied`.
  - Access keys are in `~/af/af_lms/.env.local` and need to also go in **staging Amplify + prod Amplify** env vars before merge to prod.

## What's left (this plan)

Build the LMS side end-to-end: backend API routes (proxy uploads to S3 + db-service), frontend documents UI (list + upload modal), and tests.

---

## Architecture

```
Browser (teacher's phone)
   │ multipart POST: N image blobs + document_type
   ▼
Next.js API route: POST /api/students/[id]/documents
   │ for each blob: s3:PutObject → lms-documents/students/{id}/{type}/{uuid}/page-{n}.jpg
   │ then: POST db-service /api/lms-student-document  { student_id, document_type, pages, uploaded_by }
   │ on any failure: best-effort delete S3 objects, return 5xx
   ▼
S3 holds the bytes
db-service holds the metadata row
```

**Atomicity model (Model A from the design discussion):**
- The schema allows multiple active rows per `(student, document_type)` — re-upload = upload new + delete old as two distinct actions.
- The UI shows all active docs newest-first, plus a collapsed "Show deleted (N)" footer.
- No undelete in the UI (recover via psql in the rare case).

---

## Backend

### New lib modules

#### `src/lib/s3.ts`

S3 client singleton + helpers. Mirrors the pattern of `src/lib/dynamodb.ts`.

```typescript
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const region = process.env.S3_DOCS_REGION!;
const bucket = process.env.S3_DOCS_BUCKET!;
const prefix = process.env.S3_DOCS_PREFIX!; // "lms-documents"

let _client: S3Client | null = null;
function client() {
  if (!_client) _client = new S3Client({
    region,
    credentials: {
      accessKeyId: process.env.S3_DOCS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_DOCS_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

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

export async function uploadDocumentPages(opts: {
  studentId: number;
  documentType: string;
  documentUuid: string;
  pages: PageUpload[];
}): Promise<UploadedPage[]> { /* loop, PutObject, return keys */ }

export async function deleteDocumentObjects(s3Keys: string[]): Promise<void> { /* best-effort */ }

export function buildKey(opts: { studentId: number; documentType: string; documentUuid: string; pageNumber: number; extension: string }): string {
  return `${prefix}/students/${studentId}/${documentType}/${documentUuid}/page-${pageNumber}.${extension}`;
}
```

Notes:
- Use `Buffer` not `Blob` — Node 22 / Next.js API routes work in Node runtime.
- `uploadDocumentPages` runs PUTs sequentially (not Promise.all) so a partial failure leaves a known prefix to clean up. Could parallelize later if perf is an issue.
- `deleteDocumentObjects` swallows individual errors — best-effort cleanup, never throws.

#### `src/lib/document-types.ts`

Allowlist matching db-service's `LmsStudentDocument.@document_types`. Keep these in sync manually for now (they diverge rarely, and a shared source-of-truth crosses a language boundary).

```typescript
export const DOCUMENT_TYPES = [
  { value: "research_consent", label: "Research consent" },
  { value: "id_proof", label: "ID proof" },
  { value: "bonafide", label: "Bonafide certificate" },
  { value: "other", label: "Other" },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]["value"];

export function isValidDocumentType(s: string): s is DocumentType { ... }
export function labelFor(type: DocumentType): string { ... }
```

#### `src/lib/db-service-documents.ts`

Thin wrappers around the db-service endpoints. Mirrors `src/lib/db.ts` / `src/lib/api-auth.ts` patterns.

```typescript
interface LmsStudentDocumentRow {
  id: number;
  student_id: number;
  document_type: string;
  pages: UploadedPage[];
  metadata: Record<string, unknown>;
  uploaded_by: string;
  deleted_at: string | null;
  inserted_at: string;
  updated_at: string;
}

export async function listDocuments(studentId: number): Promise<LmsStudentDocumentRow[]>
export async function createDocument(row: Omit<LmsStudentDocumentRow, "id" | "deleted_at" | "inserted_at" | "updated_at">): Promise<LmsStudentDocumentRow>
export async function softDeleteDocument(id: number): Promise<void>
```

All three use `DB_SERVICE_URL` + `DB_SERVICE_TOKEN` (existing env vars). Existing `fetch` proxying pattern lives in `src/app/api/student/route.ts` — match it.

### New API routes

#### `src/app/api/students/[id]/documents/route.ts`

**GET** — list documents for a student.
- Auth: `getServerSession` → `canAccessStudent(session, studentId)` (need to add this helper to `src/lib/permissions.ts` if it doesn't exist; right now we have `canAccessSchool` — likely just check the student's school).
- Calls `listDocuments(studentId)` and returns the array.
- Excludes soft-deleted (db-service already filters; double check by inspecting the response).

**POST** — upload a new document.
- Auth: same as GET.
- Body: `multipart/form-data` with:
  - `document_type` (string)
  - `metadata` (JSON string, optional)
  - `page_<n>` (file fields, 1-indexed, contiguous)
- Steps:
  1. Validate `document_type` via `isValidDocumentType`.
  2. Collect files in order `page_1`, `page_2`, ... and validate based on mode (auto-detected from the first file's MIME):
     - **Photos mode** — MIME allowlist `image/jpeg`, `image/png`, `image/webp`, `image/heic`; max 10 MB per file (raw, pre-downscale on client); 1–10 pages.
     - **PDF mode** — MIME `application/pdf`; max 5 MB; exactly 1 file (page_1 only). Reject if any additional `page_<n>` field is present alongside a PDF.
  3. Generate `documentUuid = crypto.randomUUID()`.
  4. Call `uploadDocumentPages({ studentId, documentType, documentUuid, pages })`.
  5. Call `createDocument({ student_id: studentId, document_type, pages: <result>, metadata, uploaded_by: session.user.email })`.
  6. On any failure between steps 4-5: call `deleteDocumentObjects(uploadedKeys)`. Don't let cleanup errors mask the original error.
  7. Return `201 Created` with the row.

Error contract:
- `400` — validation (bad type, too many pages, oversized file, bad MIME)
- `403` — auth/permission
- `502` — S3 or db-service unreachable
- `500` — anything else

#### `src/app/api/students/[id]/documents/[docId]/route.ts`

**DELETE** — soft delete a document. Auth same as above; calls `softDeleteDocument(docId)`. Returns `204`.

(GET/show is unused by the UI in v1 — list response has the full row including page array. Skip.)

### Backend tests

In `src/app/api/students/[id]/documents/route.test.ts` and `[docId]/route.test.ts`:

- POST photos-mode happy path (mock S3 + db-service)
- POST PDF-mode happy path (single file, key ends `.pdf`)
- POST validates document_type
- POST rejects empty pages
- POST rejects oversized files (>10 MB photo, >5 MB PDF)
- POST rejects bad MIME types (e.g. `text/plain`, `image/gif`)
- POST rejects too many pages (max 10 in photos mode)
- POST rejects multi-file PDF mode
- POST: S3 PUT failure cleans up partial uploads, returns 502
- POST: db-service POST failure cleans up all S3 objects, returns 502
- POST: auth required (session = null → 401, wrong school → 403)
- GET happy path
- GET filters out deleted (or rather, verifies db-service is doing it)
- GET auth gates
- DELETE happy path
- DELETE auth gates
- DELETE 404 for nonexistent doc

In `src/lib/s3.test.ts`:

- `buildKey` produces the expected path
- `uploadDocumentPages` calls `PutObjectCommand` with right bucket/key/body for each page
- `uploadDocumentPages` returns keys in input order
- `uploadDocumentPages` throws on first failure, with prior keys returned somehow so caller can clean up (alternatively: returns a tuple `{ uploaded: [], error: ... }`)
- `deleteDocumentObjects` swallows individual errors

Use `aws-sdk-client-mock` (small dep, well-supported) to mock the S3 client cleanly.

---

## Frontend

### New components

All under `src/components/documents/`.

#### `DocumentsList.tsx`

Read-only list of active documents for a student. Rendered inline inside the expanded row in `StudentTable` — no upload affordance here (upload lives in the Documents tab of `EditStudentModal`).

```typescript
interface Props {
  studentId: number;
}

export function DocumentsList({ studentId }: Props) {
  // useEffect → fetch /api/students/[id]/documents
  // useState for docs list + loading + error
  // Renders:
  //   - Loading state: small spinner
  //   - Empty state: "No documents yet"
  //   - Populated: list of DocumentCard, sorted by inserted_at desc
  // DocumentCard's onDelete refreshes list (delete remains available in the read-only viewer)
}
```

**Deleted documents** — out of scope for v1 (the db-service GET filters them out and we won't add `include_deleted` until a followup PR). No "Show deleted" toggle.

#### `UploadDocumentForm.tsx`

The upload form. Rendered inside the "Documents" tab of `EditStudentModal` (not a separate modal). Uses the explicit Photos vs PDF mode toggle.

```typescript
interface Props {
  studentId: number;
  studentName: string;
  onUploaded: () => void;          // triggers DocumentsList refresh in modal + parent
}

// State:
//   - mode: "photos" | "pdf"      (toggle at top of form)
//   - documentType: DocumentType
//   - photos: { blob: Blob; previewUrl: string }[]   (Photos mode only)
//   - pdf: { file: File } | null                     (PDF mode only)
//   - submitting: boolean
//   - error: string | null
//
// Layout:
//   [ Photos | PDF ]   ← mode toggle
//   Type: [ <select> ]
//
//   Photos mode:
//     [ thumb 1 ✕ ] [ thumb 2 ✕ ] [ + Add page ]
//   PDF mode:
//     [ + Select PDF ]    ← then shows "filename.pdf (123 KB)  ✕"
//
//   [ Cancel ]                      [ Submit (N pages) | Submit PDF ]
//
// Photos "+ Add page": opens hidden <input type="file" accept="image/*" capture="environment" />
//   On change: read file → downscale → push to photos
// PDF "+ Select PDF": opens hidden <input type="file" accept="application/pdf" />
//   On change: validate ≤5 MB, set pdf state. No downscale.
// Submit: build FormData (page_1, page_2, ...) + document_type, POST to /api/students/[id]/documents
//   - Disabled if (photos mode && photos.length === 0) || (pdf mode && !pdf) || !documentType
//   - Shows progress bar "Uploading…"
//   - On 2xx: onUploaded(); reset form
//   - On error: error state, form stays populated
```

Browser-side downscale (Photos mode only) — see image-resize util below.

#### `PageThumbnail.tsx`

Tiny dumb component: square thumbnail (objectFit: cover), a small × button overlay top-right, page number label. Reused inside the modal.

#### `DocumentCard.tsx`

One document in the DocumentsList. Shows: doc type label, page count, uploader email, formatted date, [Delete] button. Clicking the card opens a viewer (Phase 2 — see below).

```typescript
interface Props {
  doc: LmsStudentDocumentRow;
  onDelete: (id: number) => void;
  isDeleted?: boolean;  // styling only
}
```

For v1, no preview/viewer; just metadata + delete. To view a page, generate a presigned GET URL (Phase 2 — see "Out of scope" below).

### New util

#### `src/lib/image-resize.ts`

Client-side downscale before upload. Target: max dimension 1500px, JPEG quality 0.8, output as Blob. Use `<canvas>` + `canvas.toBlob`.

```typescript
export async function downscaleImage(file: File, opts?: { maxDim?: number; quality?: number }): Promise<Blob>
```

Tests in `src/lib/image-resize.test.ts`. Will need to stub `HTMLCanvasElement` in jsdom or use happy-dom; check what `vitest.config.ts` is configured for.

### Integration

**Decision:** split the upload affordance from the viewing affordance.

- **Upload** → new "Documents" tab inside `EditStudentModal`, alongside the existing form tab. Holds the `UploadDocumentForm` (mode toggle, type select, files, submit). After a successful upload, the modal also re-renders its own `DocumentsList` so the new doc is visible without closing the modal.
- **View** → `DocumentsList` rendered inline inside the expanded row in `StudentTable` (`StudentCard` already has an expand/collapse). A user opens the row and sees existing documents + delete buttons, without entering edit mode.

`EditStudentModal` needs a small refactor to add a tab switcher (existing form becomes "Details" tab, new "Documents" tab holds the form + list). `StudentTable` needs to pass `studentId` into the expanded section and render `<DocumentsList studentId={...} />` below the current detail grid.

### Frontend tests

Component tests in `src/components/documents/*.test.tsx`:

- `UploadDocumentForm`: renders, mode toggle Photos↔PDF, type selector, add/remove pages (photos mode), select/clear PDF (pdf mode), submit posts FormData, error path leaves form populated, downscale called on add in Photos mode (not PDF mode)
- `DocumentsList`: loading state, empty state, populated state, refresh after parent triggers
- `DocumentCard`: renders fields (incl. PDF label), delete button calls onDelete
- `PageThumbnail`: render + ✕ click

Manual / E2E with Playwright (optional for v1, recommended): one happy-path spec in `e2e/tests/documents.spec.ts` covering upload + list + delete. Use a fixture file as the "captured photo" stand-in (Playwright doesn't simulate cameras; just programmatically sets the `<input type="file" />` value).

---

## Decisions (resolved 2026-05-29)

1. **Integration** — upload lives in a new "Documents" tab inside `EditStudentModal`. Read-only view lives inline in the expanded `StudentTable` row.
2. **MIME allowlist** — Photos: `image/jpeg`, `image/png`, `image/webp`, `image/heic`. PDF: `application/pdf`. No other types in v1.
3. **PDF mode** — single-file upload, max 5 MB, no downscale. Explicit Photos↔PDF toggle in the upload form (no auto-detect).
4. **Max pages per document (Photos mode)** — 10.
5. **Max file size per page (Photos mode, raw / pre-downscale)** — 10 MB. Client-side downscale brings most uploads to ~500 KB before they hit S3. Canvas downscaling works in mobile browsers (Safari iOS, Chrome Android, Firefox). Known gotcha: HEIC photos from iPhone won't decode in Chrome Android's `<canvas>` — handle if/when it bites (likely `heic2any` fallback; defer).
6. **Permissions** — uniform: any user with `canAccessSchool` for the student's school can view, upload, and delete documents (matching how edits and visits work today). No admin-only delete in v1.
7. **Soft-deleted documents** — not surfaced in v1. No "Show deleted" toggle, no `include_deleted` query param. db-service GET filters deleted out; recovery is psql-only. Followup PR can add `include_deleted` later if a use case appears.

---

## Order of work

Roughly two days; can be split between people if needed.

### Day 1 — backend (4-6 h)

1. `src/lib/s3.ts` + `aws-sdk-client-mock` test setup
2. `src/lib/document-types.ts` + `src/lib/db-service-documents.ts`
3. `POST /api/students/[id]/documents/route.ts` + tests
4. `DELETE /api/students/[id]/documents/[docId]/route.ts` + tests
5. `GET /api/students/[id]/documents/route.ts` + tests
6. Commit, push, open draft PR

### Day 2 — frontend (4-6 h)

7. `src/lib/image-resize.ts` + tests
8. `PageThumbnail.tsx` + tests
9. `UploadDocumentForm.tsx` + tests (Photos + PDF modes)
10. `DocumentCard.tsx` + tests
11. `DocumentsList.tsx` + tests
12. Integration: add "Documents" tab to `EditStudentModal` (form + list); render `DocumentsList` inline in expanded `StudentTable` row
13. Mark PR ready for review

### Day 3 — verification + ship (2-3 h)

14. Real-device manual test: teacher@gmail account → school → student → upload 2-page consent on phone → verify in DB
15. Re-test on prod after merge (S3 keys live with prod data; just verify nothing dump-related breaks)
16. Update TODOS.md, close out

---

## Out of scope for v1 (Phase 2)

- **Document viewer / preview** — clicking a card downloads pages or opens a lightbox. Needs `GET /api/students/[id]/documents/[docId]/page/[n]` that issues a presigned GET URL.
- **Document audit log** — who viewed what, when. Separate `lms_student_document_audit_log` table + middleware in the GET routes.
- **PDF support** — accept PDF uploads as a single "page", or convert to images. Defer.
- **Drag-and-drop file picker** — for desktop usage. The camera-only flow is fine for mobile.
- **Bulk upload** — multiple students at once. Almost certainly not needed for consent forms.
- **Re-arrange pages** — let teacher reorder pages 1, 2, 3 after capturing. Defer; teacher can remove + re-add in correct order for v1.
- **Download as combined PDF** — server-side image stitching. Defer until someone asks.

---

## Risks / gotchas

- **AWS SDK v3 cold start on serverless** — Amplify uses Lambda under the hood; AWS SDK v3 has a tree-shaken-but-still-noticeable cold start. Should be <1s, acceptable for uploads. Worth measuring once live.
- **Memory pressure from large uploads** — Next.js API routes buffer the multipart body in memory by default. 10 pages × 10 MB = 100 MB per request peaks. The downscale happens client-side, so realistically we'll see 10 × 500 KB = 5 MB. Fine for Amplify Lambda's default 512 MB.
- **HEIC handling** — some browsers can't decode HEIC for the `<canvas>` downscale step. Safari on iOS handles it natively; Chrome on Android does not. Need to test on Android with iPhone photos; fallback: pass HEIC through to S3 without downscaling (size penalty), or use `heic2any` (npm) to convert client-side. Pick approach after testing.
- **Bucket name in code paths** — bucket and prefix come from env vars. Don't hardcode `avantifellows-documents` or `lms-documents` anywhere except `.env.example`.
- **Amplify env vars** — staging and prod each need the 5 `S3_DOCS_*` vars. Easy to forget when promoting — note in PR description.
- **The keys printed in the conversation today** are sensitive. Don't commit them. They live in `.env.local` (gitignored) and Amplify console only. If they leak, rotate via `aws iam delete-access-key` + `aws iam create-access-key`.

---

## Acceptance criteria (the "this is done" checklist)

- [ ] Teacher on a phone can upload a 2-page research consent for a student. Both pages appear in S3 under `lms-documents/students/{id}/research_consent/{uuid}/page-{1,2}.jpg`. A row exists in `lms_student_documents` with both keys in `pages`.
- [ ] Teacher can see the uploaded document in the student's Documents list, with correct type, page count, uploader email, and timestamp.
- [ ] Teacher can delete the document. Row's `deleted_at` is set; document disappears from the active list.
- [ ] "Show deleted" toggle reveals the deleted doc in gray.
- [ ] If upload fails mid-flight, no orphan row exists in db-service. S3 may have orphan objects (acceptable for v1; rare).
- [ ] A user without access to the student's school gets 403 on all endpoints.
- [ ] All unit tests pass; coverage doesn't regress.
- [ ] Manual test on real phone passes.

---

## Reference links

- db-service PR: https://github.com/avantifellows/db-service/pull/514
- db-service endpoint base: `https://staging-db.avantifellows.org/api/lms-student-document`
- AWS bucket: `arn:aws:s3:::avantifellows-documents` (region `ap-south-1`)
- IAM user: `af-lms-s3` (account `111766607077`)
