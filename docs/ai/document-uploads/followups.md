# Document Uploads — Followups

Risks and gotchas surfaced while implementing the document-uploads backend
(branch `document-uploads`, 2026-05-29). Captured here for a future pass — none
are blocking v1, but each will eventually matter.

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

## Related, already-tracked

- Backfill `canAccessStudent` into existing per-student write routes — see
  `~/af/worklog/TODOS.md` Active section.
- The plan doc (`2026-05-28-implementation-plan.md`) tracks Phase 2 items
  (viewer, audit log, PDF combining) separately from these risks.
