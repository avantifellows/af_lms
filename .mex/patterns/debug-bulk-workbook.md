---
name: debug-bulk-workbook
description: Diagnose uploaded spreadsheets without importing students or exposing their data.
last_updated: 2026-09-12
---

# Debug Bulk Workbooks

## Steps
1. Read `context/student-addition.md`. Check the file signature, not just its extension.
2. Ordinary XLSX is a ZIP package. An OLE/compound file can be an encrypted XLSX; the signature alone does not mean legacy XLS or a user password.
3. `student-addition-workbook.ts` reads EncryptionInfo and attempts only Excel's public built-in password (`VelvetSweatshop`). Excel can open these files without prompting. Standard/Agile automatic encryption is supported; custom passwords and unsupported encryption fail clearly. Keep the Agile work-factor bound.
4. Pass the original bytes through `parseStudentAdditionUpload` locally. Report counts and row numbers, not names, phones, or other student data. Never commit supplied workbooks as fixtures.
5. Distinguish a read failure from template errors, ignored examples, and row errors. In Phone mode the shared parser rejects every repeated valid phone before either Check or Add.

6. For dropdown rejects, compare the submitted value against the configured options in `student-addition-fields.ts`; workbook dropdown edits do not expand LMS choices. Preserve aliases and case/outer-space normalization. Keep unsupported-choice metadata separate from message text so required blanks and unrelated errors cannot trigger template guidance.

## Verify
- Use synthetic encrypted workbooks for committed tests; test the supplied workbook locally only.
- Check must make zero DB Service calls. Add must repeat validation and forward only ready rows.
- Exercise ordinary XLSX/CSV, automatic Standard/Agile encryption, custom passwords, and malformed input.
- Check unsupported choices and required blanks in both modes, preview/final error parity, and correction CSV round-trips (including quotes, commas, and newlines). Confirm the guidance appears once above the preview table only for unsupported choices; inspect long/unbroken messages on desktop and mobile.
- Compare decoded CSV error cells with the displayed messages: labels must not repeat, and separate errors must use line breaks without period-semicolon separators. Include Annual Family Income, whose validation label differs from its column header.
- Run the build to verify Node dependency bundling and update the context when behavior changes.
