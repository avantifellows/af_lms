---
name: add-student-enrolment-field
description: Add a field to the Student Enrolment form. It is always a coordinated AF LMS + DB Service change, because the LMS ingestion endpoint rejects a row key it does not know.
triggers:
  - "add a field to enrolment"
  - "student enrolment field"
  - "new student field"
  - "add dropdown to add student"
edges:
  - target: context/student-addition.md
    condition: for the full enrolment, bulk-upload and Registration Mode contract
  - target: patterns/db-service-write.md
    condition: when the field also needs to be editable after enrolment
  - target: context/conventions.md
    condition: for the closed-code-set rule a dropdown field must follow
last_updated: 2026-10-08
---

# Add a field to the Student Enrolment form

## Context
The Add Student form posts to `POST /api/school/[udise]/students`, which validates the row
and proxies it to the DB Service at `/lms/students/bulk-create-with-enrollments`. That
endpoint (`lib/dbservice/lms_student_ingestion.ex`) builds the student attributes from a
**literal map** — a key it does not name is dropped in Approved mode, and under the active
Phone Registration Mode it is worse: any key outside `@phone_allowed_row_keys` rejects the
whole row with `"Unknown fields are not allowed in phone mode: <key>"`.

So a column existing on `student`, and even being cast by `Student.changeset`, is **not**
enough. `Student.changeset` covers `PATCH /student/:id` (Edit Student); it does not cover
enrolment. Check `lms_student_ingestion.ex` directly, never the schema alone.

## Steps
1. **DB Service first.** Confirm the column, its CHECK constraint and the `changeset` cast
   exist. Then in `lib/dbservice/lms_student_ingestion.ex`:
   - add the key to `@phone_allowed_row_keys`;
   - add it to the `"student"` attrs map in **both** `normalize_phone_row/2` and
     `normalize_row/2`;
   - add a `validate_*` clause to **both** `classify_phone_row/3` and `classify_row/3` so an
     unsupported value gets a named error instead of the generic
     "Student could not be created. Please contact the admin" from the failed `Multi`.
2. **A closed set lives in one client-safe `src/lib/*` module** (`uniform-sizes.ts`,
   `exam-tracks.ts`): codes + type guard + display labels, no server-only imports. If the
   form offers only part of the stored vocabulary, name that subset in the same module.
3. `src/lib/student-addition-fields.ts`: add the key to `StudentAdditionInput` and
   `LmsStudentAdditionRow`, then canonicalize it in `validateStudentAdditionInput`. Omit an
   optional blank from the row rather than sending `""`.
4. `src/components/enrollment/AddStudentModal.tsx`: add the key to `initialForm` and render
   the control. **If the field is not a bulk-upload column**, add it to `FORM_ONLY_FIELDS` —
   `fieldsForRegistrationMode` otherwise filters it out of the Phone-mode submission.
5. Only touch `getStudentAdditionUploadColumns` if the field really belongs in bulk upload;
   that list is the template contract and the static workbook must be regenerated with it.

## Gotchas
- **The two repos must deploy together.** The LMS change alone breaks Phone-mode enrolment
  for every row; the DB Service change alone is inert. Same shape as the Registration Mode
  handshake in `src/lib/registration-mode.ts`.
- **Store the code, not the label.** A dropdown whose option text carries extra context (a
  measurement, a full exam name) still submits the bare code the CHECK constraint accepts.
- An approved-mode test in the DB Service suite must call
  `LmsStudentRegistrationMode.put_test_active_mode("approved")`, or it gets a 409 mismatch.
- A field added to the form but not to Edit Student can never be corrected afterwards —
  decide that explicitly rather than by omission.

## Verify
- [ ] `@phone_allowed_row_keys` names the key, and both normalize functions map it.
- [ ] Both classify pipelines reject an unsupported value with a named message.
- [ ] A Phone-mode ingestion test asserts the value persists (not "unknown field").
- [ ] The LMS row omits the key when the field is blank and optional.
- [ ] `npm test`, `npm run lint`, `npm run build`, and `mix format --check-formatted` pass.

## Debug
- Every Phone-mode row rejected as "Unknown fields are not allowed" → the key is missing
  from `@phone_allowed_row_keys`.
- Row created but the value is null → the key is missing from the `"student"` attrs map.
- "Student could not be created. Please contact the admin" → the `Student.changeset`
  validation failed; add the explicit `validate_*` clause so the message names the field.

## Update Scaffold
- [ ] Record the new field and its coordinated-release requirement in
      `context/student-addition.md` and the ROUTER's Current Project State.
