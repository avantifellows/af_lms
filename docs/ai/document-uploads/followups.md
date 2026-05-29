# Document Uploads — Followups

Risks and gotchas surfaced while implementing the document-uploads backend
(branch `document-uploads`, 2026-05-29). Captured here for a future pass — none
are blocking v1, but each will eventually matter.

## Resolved in this PR (code-review fixes)

Listed for traceability — these came from `/code-review` and were applied to
the original feature commit:

- **DELETE doc ownership check** — IDOR closed. DELETE now lists the
  student's docs and verifies the docId belongs before forwarding to
  db-service.
- **Feature-edit access gate** — POST and DELETE now require
  `canAccessStudent(..., { requireEdit: true })`, which honors
  `permission.read_only` and the `getFeatureAccess(..., "students")` matrix.
  Read-only program_admins can no longer mutate via direct API calls.
- **listDocuments defense-in-depth** — also filters client-side on
  `student_id` so a misbehaving upstream can't leak cross-student docs.
- **Inline DocumentsList stale after modal upload** — wired
  `documentsRefreshNonce` from StudentTable → StudentCard → DocumentsList.
  EditStudentModal calls `onSave()` from upload + delete paths to bump it.
- **UploadDocumentForm blob-URL leak + post-unmount setState** — replaced the
  broken empty-deps useEffect with a `createdUrlsRef` Set + `isMountedRef`
  guard.
- **`res.json()` SyntaxError now becomes DbServiceError** instead of bubbling
  as an unhandled 500.
- **parseInt trailing-junk rejection** — all three document routes now use
  `/^\d+$/` before `Number.parseInt`.
- **`Number(student.student_pk_id)` NaN escape** — `EditStudentModal` and
  `StudentTable` now reject non-numeric IDs cleanly.
- **DocumentsList sort comparator** now returns 0 on ties (TimSort
  antisymmetry).

## Priority 1 — should resolve before/around merge

- [ ] **Confirm Amplify request-body limit.** AWS API Gateway caps synchronous
      Lambda payloads at 6 MB. The client downscales photos to ~500 KB so 10
      photos ≈ 5 MB (under). But if HEIC-on-Android fallback or desktop upload
      ever skips downscale, we'll hit the gateway limit *before* our route
      runs — user gets a generic 413, not our validation message. Either:
      (a) verify the actual Amplify limit, (b) lower `MAX_PHOTOS` to 5 as a
      safety margin, or (c) measure real-world body sizes during manual
      device testing.
- [ ] **Cap `metadata` field size** (~4 KB). Currently we accept any JSON
      object and pass straight to db-service JSONB. A client could shove 5 MB
      of junk into the row. One-line fix in `POST` route.
- [ ] **Error on page-number gaps**, don't silently drop. If client sends
      `page_1, page_3` (skipping 2), `collectPageFiles` stops at the gap and
      uploads only page_1. Fix: after the loop, scan for `page_<N+1>` etc. up
      to some bound and 400 if found. ~3 lines in `route.ts`.

## Priority 2 — defense in depth before Phase 2

- [ ] **Magic-byte content check** before S3 PUT. We currently trust the
      multipart `Content-Type` header. A `.exe` labeled `image/jpeg` would go
      to S3 with `ContentType: image/jpeg` set on the object. Bucket is
      private in v1 so the blast radius is small — but Phase 2 will ship a
      presigned-GET viewer and at that point we're effectively a content
      host. Cheapest defense: validate the first few bytes match the claimed
      MIME (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WEBP `RIFF…WEBP`,
      PDF `%PDF`).
- [ ] **Orphan S3 sweeper.** Cleanup on db-service failure is best-effort —
      if cleanup itself fails (S3 hiccup mid-rollback), bytes stay in S3
      forever with no row pointing at them. The lifecycle rule expires only
      *noncurrent* versions, not current. Need either: a periodic
      reconciliation job (list S3 prefix → diff against db-service rows →
      delete unmatched), or a "current versions older than 30 days with no
      row" lifecycle hack. Probably a small Lambda triggered weekly.

## Priority 3 — quality-of-life

- [ ] **Idempotency key on POST.** Client retry on flaky network currently
      creates duplicate documents (two rows, two S3 prefixes). Mitigation:
      accept `Idempotency-Key` header; check before `createDocument`.
- [ ] **Rate limit upload route.** No throttling — a bug or bad actor could
      DOS by spamming uploads to one student. Probably fine inside an
      internal-team app, but flagged. Cheapest: lean on Amplify's WAF or
      Cloudfront request-rate rules; otherwise per-user counters in Redis.
- [ ] **Better error mapping from `DbServiceError`.** Currently everything
      non-404 becomes 502 in DELETE and POST. A 422 from db-service
      (validation failure) should probably surface as 400 with the upstream
      message so the client can show a useful error.
- [ ] **PDF-mode error message on mixed files.** "PDF mode accepts exactly
      one file" is misleading when the client sent `page_1 = PDF, page_2 =
      JPEG`. Real cause is mixed types. Improve copy.

## Priority 4 — accepted for v1, revisit if it bites

- [ ] **Schema drift between Elixir `LmsStudentDocument.@document_types` and
      `src/lib/document-types.ts`.** Currently hand-mirrored. Worth codegen
      or a CI check eventually.
- [ ] **Parallelize S3 PUTs.** Sequential PUTs are ~200ms each; 10 photos =
      ~2s before db-service write. Parallel with careful cleanup tracking
      would halve that. Not worth the complexity at v1 traffic.
- [ ] **Streaming multipart parser.** Validation happens after the whole
      body buffers in memory, so the 10MB-per-page cap doesn't actually
      protect Lambda memory during the parse phase. Lambda's 512MB makes
      this survivable, but a streaming parser is the proper fix.
- [ ] **Test fetch mock isn't a real `Response`.** Returns a plain object
      with `ok/status/json/text`. Today's code only uses those four; a
      future refactor that touches `headers` or `redirect` could silently
      lose test coverage.

## Remaining code-review findings (deferred from this PR)

These were surfaced by `/code-review` and judged safe to roll forward. Address
on a follow-up sweep.

### Correctness — open

- [ ] **`extensionFor` runs outside the inner try/catch in `uploadDocumentPages`.**
      Today this is latent (ALLOWED_PHOTO_MIMES and MIME_TO_EXTENSION are
      aligned), but if someone adds a new MIME to the route's allowlist
      without a matching `MIME_TO_EXTENSION` entry, page N's `extensionFor`
      throws *after* pages 1..N-1 already PUT to S3. The bare Error isn't an
      `S3UploadError`, so the route's catch falls to the generic else branch
      and never calls `deleteDocumentObjects` on the already-uploaded keys —
      orphans. Fix: either validate all extensions up front before the loop,
      or wrap `extensionFor`/`buildKey` inside the inner try/catch so they
      throw `S3UploadError(uploaded, err)`.
- [ ] **`DocumentsList` has no AbortController / stale-request guard.** If
      `studentId` changes mid-fetch and the older response arrives last, it
      overwrites the new student's data. Same window applies to `setError`.
      Fix: abort in cleanup and check `signal.aborted` before setState.
- [ ] **PDF detection fails on `application/octet-stream`.** Mobile share-sheet
      flows sometimes submit PDFs with that MIME; the route currently routes
      them into the photos branch and returns a confusing "Unsupported MIME
      type" error. Either accept an explicit `mode` form field from the
      client, or magic-byte sniff (`%PDF-`).
- [ ] **Two-phase write: `NextResponse.json` throw after `createDocument`
      success → orphan row.** If the response-serialization step somehow
      throws (rare — circular ref, BigInt without toJSON), the catch runs
      `deleteDocumentObjects` while the db row exists, leaving the row
      pointing at deleted S3 keys. Distinguish "createDocument failed
      (cleanup S3)" from "response failed (don't cleanup)".

### UX / policy — open

- [ ] **Dropout students still get inline DocumentsList with delete buttons.**
      Edit/Dropout buttons are explicitly hidden via `canEdit && !isDropout`,
      but the expanded section unconditionally renders DocumentsList with
      `canDelete={canEdit}`. If dropouts are meant to be append-only for the
      historical record, this is a policy gap. Either add `!isDropout` to
      `canDelete`, or pass a separate `isDropout` prop and disable delete
      when true.

### Cleanup / altitude — open

- [ ] **`gateOrError` duplicated across three document routes.** Lift into
      `src/lib/student-route-auth.ts` (or similar) and import from each route
      so future changes to the 401/403/400 contract live in one place.
- [ ] **Tab markup duplicated** between `UploadDocumentForm` and
      `EditStudentModal`. Extract a shared `<Tabs>` component in
      `src/components/ui/` and export it via the index.
- [ ] **Limits duplicated client/server.** `MAX_PHOTOS`, `MAX_PHOTO_BYTES`,
      `MAX_PDF_BYTES`, `PHOTO_MIMES` exist verbatim in both
      `UploadDocumentForm.tsx` and `route.ts`. Hoist into
      `src/lib/document-types.ts` (or a sibling `document-limits.ts`) and
      import in both places.
- [ ] **`student_pk_id: string | null` type drift.** Originates from a
      numeric PG column but typed as string here, forcing `Number(...)`
      coercion at every leaf consumer. Type it as `number | null` at the
      boundary (the page-level query mapping) so leaf components don't carry
      the coercion. Touched StudentTable + EditStudentModal in this PR; will
      keep growing as more per-student features land.
- [ ] **Viewer route calls `listDocuments` to find a single doc.** Each
      page-link click pulls every doc for that student over HTTP. A
      `getDocument(studentId, documentId)` proxy that hits db-service's
      `/lms-student-document/:id` (or a column-projection endpoint) would be
      cheaper.
- [ ] **EditStudentModal Documents tab unmounts on switch back to Details.**
      That re-mounts `DocumentsList` and re-fetches on every tab toggle. Lift
      state into the modal or toggle visibility via CSS.
- [ ] **`DbServiceError` mapping is too coarse** — non-404 → 502 swallows
      validation errors. Surface 422 from db-service as 400 with the upstream
      message so the client can show a useful error.
- [ ] **`process.env` read on every API call** for `DB_SERVICE_URL`/`TOKEN`.
      Memoize at module load with a single null-check throw — micro perf but
      surfaces misconfig at boot rather than first request.

## Related, already-tracked

- Backfill `canAccessStudent` into existing per-student write routes — see
  `~/af/worklog/TODOS.md` Active section.
- The plan doc (`2026-05-28-implementation-plan.md`) tracks Phase 2 items
  (viewer, audit log, PDF combining) separately from these risks.
