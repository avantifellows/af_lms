---
name: presigned-s3-upload
description: Let the browser upload a large file straight to S3 with a presigned PUT, then record it server-side after checking the key and the object. Use when a file is too big to proxy through an API route (Amplify Lambda body limits) — e.g. Blended Learning Call Recordings.
triggers:
  - "presigned upload"
  - "presigned put"
  - "direct to s3"
  - "large file upload"
  - "upload progress"
  - "call recording upload"
edges:
  - target: patterns/add-api-route.md
    condition: for the gate shape of the two routes (issue URL, then record)
  - target: patterns/add-component.md
    condition: for the client component and its colocated test (fake XHR)
  - target: context/data-access.md
    condition: for the Blended Learning recording flow this pattern came from (#449)
  - target: context/setup.md
    condition: for the S3_DOCS_* env vars, the lms-documents prefix and the CORS rollout note
last_updated: 2026-10-22
---

# Presigned direct-to-S3 upload

## Context
API routes run on Amplify's Lambda, which caps request bodies (~6 MB) and time (~30 s), so a
large file (a 200 MB Call Recording) cannot go through a route the way photos do
(`uploadObject` in a multipart POST). Instead the server signs a short-lived `PutObject` URL,
the browser PUTs the file to S3 itself, and a second request records it once the server has
checked the key and the object. Reference: `src/lib/blended-learning-drafts.ts`
(`issueRecordingUpload`, `createDraft`), `src/lib/s3.ts` (`presignUpload`, `headObject`,
`blendedLearningRecordingPrefix`), `src/app/blended-learning/students/[id]/log/RecordingUpload.tsx`.

## Steps
1. **Issue route** (`POST …/upload-url`): gate (session → feature policy → mutation allowed →
   resource in scope), then validate the file *by extension* (phones send empty or odd MIME
   types) and size, and any business precondition (e.g. 409 if an open draft exists). Build the
   key server-side: `{prefix}/<area>/{ownerId}/{randomUUID()}.{ext}` with a `src/lib/s3.ts`
   prefix helper. Return `{ uploadUrl, s3Key, contentType }` from
   `presignUpload({ s3Key, contentType, ttlSeconds })` (15 minutes; `content-type` is signed, so
   the browser must send exactly that type).
2. **Browser PUT**: `XMLHttpRequest` (not `fetch`, which has no upload progress) with
   `setRequestHeader("Content-Type", contentType)` and `xhr.upload.onprogress`. On error, keep the
   `File` and offer Retry: restart from step 1 (a fresh key) if the PUT failed, or repeat only
   step 3 if the PUT finished. Don't offer retry for permanent refusals (403/404/409).
3. **Record route** (`POST …` creating the row): re-gate, then before any transaction check
   that the key is exactly this owner's prefix + UUID + allowed extension (regex on the suffix
   after the prefix — this is what stops a client pointing a row at someone else's object), and
   that `headObject(key)` exists with the claimed byte size (422 otherwise). Take the content
   type from the key's extension and the size from S3, never from the client. Enforce the size
   limit again on the size S3 reports: the presigned PUT signs only `content-type`, so the
   step-1 check saw only what the client declared (a client can upload far more). Then write
   the row(s) in one `withTransaction`; do external side effects (webhooks, wakes) after commit.
4. Never log the S3 key; log only the error's name on S3 failures.

## Testing
- Route tests: `aws-sdk-client-mock` on `S3Client` for `HeadObjectCommand`; the real presigner
  signs locally with stubbed `S3_DOCS_*` env and `__resetS3ClientForTesting()`, so assert the URL
  host, path (the key), `X-Amz-Expires` and `X-Amz-SignedHeaders` containing `content-type`.
- Component test: stub `XMLHttpRequest` with a small fake class the test drives
  (`upload.onprogress`, `onload`, `onerror`) and stub `fetch` for the two routes.
- E2E has no S3: assert the control's presence/absence and leave the upload to the route seam.

## Gotchas
- The bucket needs a CORS rule allowing `PUT` with the `Content-Type` header from the LMS
  origins, or the browser PUT fails before reaching S3. That is a rollout task, not code.
- `S3_DOCS_PREFIX` must be `lms-documents` for Blended Learning recordings: the lifecycle rule
  and etl-next read that prefix.
- Objects whose record step never happens stay in S3; for recordings the lifecycle rule
  expires them.

## Update Scaffold
- [ ] Note the new flow in `context/data-access.md` and any new env vars in `context/setup.md`.
