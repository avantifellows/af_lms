# Student Addition Bulk Upload Manual QA

Use one real-like JNV NVS workbook from Ops with Grade 11 or Grade 12 selected on
`/school/[udise]` under an allowed `admin`, `program_manager`, or
`program_admin` account.

## Workbook Cases

- Valid rows create students and refresh the active roster.
- Duplicate rows in the same file return `duplicate_in_file` and do not create a second student.
- Already-existing students return `already_exists` and do not overwrite existing data.
- Missing APAAR ID and Grade 10 Roll no returns a rejected row.
- Bad dates, including future Date of Birth, return field errors.
- Choice cell values for Gender, Category, G10 board, and Board Stream—and, in Approved mode only, Annual Family Income—accept an exact configured label after outer whitespace is trimmed and case is ignored, then return the canonical label. CWSN and Primary Exam preparing for remain case-insensitive. Fuzzy matches, synonyms, and punctuation changes remain invalid; unknown values return field errors.
- CBSE rows with a non-8-digit Grade 10 Roll no return field errors.
- Non-CBSE alphanumeric Grade 10 Roll no with 4 to 10 characters is accepted and generates an alphanumeric Student ID.
- Partial success shows created/already-present/rejected totals and a rejected-row CSV.
- Re-uploading the rejected-row CSV after offline fixes succeeds without duplicating rows already created in the first attempt.

## Two-step flow

Run this checklist in both Phone Registration Mode and Approved mode. Count browser
requests to the LMS route separately from the DB Service request; a database write
means a student row/enrollment created by the existing DB Service contract.

- Selecting a valid or invalid file only updates the modal: 0 LMS requests, 0 DB Service requests, and 0 writes.
- `Check file` sends exactly 1 read-only LMS validation request, returns the ready/rejected summary, and makes 0 DB Service requests and 0 writes. It must not show a final created result.
- For an invalid-only file, the check shows ready = 0; `Add students` stays unavailable and the flow makes 0 DB Service requests and 0 writes.
- For a mixed file, `Add students` sends exactly 1 LMS upload request. The route re-runs authoritative checks and makes exactly 1 DB Service request containing only ready rows; rejected rows cause no writes. The final result includes both authoritative statuses and local rejects.
- A header/template mismatch stops at the LMS check: 1 LMS request, 0 DB Service requests, and 0 writes; `Add students` remains unavailable until a corrected file is checked.
- Cancel/close before checking or before adding makes no additional request and no write. While adding, Close and Cancel are disabled; attempting either must not start a second request, and the existing add remains at most 1 LMS request and 1 DB Service request.
- Double-click `Check file` or `Add students`: the action is disabled while the request is in flight; expect exactly 1 LMS validation request for Check file, or exactly 1 LMS upload request and at most 1 DB Service request for Add students, with no duplicate writes.
- Force an unreadable response or timeout during `Add students`: expect exactly 1 LMS upload request, no automatic retry, a refreshed roster, and an explicit unknown final outcome. DB Service may have been called and may have written rows, so do not report success or assume zero writes; reconcile by an explicit same-file re-upload after reset.
- Use `Reset`/`Upload another` after a check, result, mismatch, or error: expect 0 requests for the reset itself, cleared file/summary/results/errors, and successful selection of the same file again. A fresh check then makes 1 LMS request; a fresh add follows the counts above.
- Repeat the checklist with Phone and Approved templates. Phone checks/results contain only active Phone-mode fields and never call DB Service during `Check file`; Approved includes its PEN, Grade 10 Roll no, and Annual Family Income fields, but the request/write counts are otherwise the same. No step changes the DB Service contract or database schema; Add students writes through the existing contract.

## Checks

- Bulk Upload is hidden when the shared Student Addition gate denies access or when the selected program is not JNV NVS.
- `.xlsx` uploads work; `.xls` shows the save-as-`.xlsx` error.
- The template downloads from the same modal and has the PRD columns.
- The Student ID guidance is visible before upload and in results.
- Rejected-row CSV contains original fields, original row number, status, field errors, row errors, and existing-match details when present.
