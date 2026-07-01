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
- Bad reference values for Gender, Category, Board Stream, Primary Exam preparing for, G10 board, and Annual Family Income return field errors.
- CBSE rows with a non-8-digit Grade 10 Roll no return field errors.
- Non-CBSE alphanumeric Grade 10 Roll no is accepted and generates an alphanumeric Student ID.
- Partial success shows created/already-present/rejected totals and a rejected-row CSV.
- Re-uploading the rejected-row CSV after offline fixes succeeds without duplicating rows already created in the first attempt.

## Checks

- Bulk Upload is hidden when the shared Student Addition gate denies access or when the selected program is not JNV NVS.
- `.xlsx` uploads work; `.xls` shows the save-as-`.xlsx` error.
- The template downloads from the same modal and has the PRD columns.
- The Student ID guidance is visible before upload and in results.
- Rejected-row CSV contains original fields, original row number, status, field errors, row errors, and existing-match details when present.
