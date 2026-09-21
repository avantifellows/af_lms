// Admission readiness metrics (grades 11 & 12).
//
// Tracks, per school, how far admissions have progressed for each grade:
//   • total students        — grade-11/12 roster size
//   • % info available      — students whose core profile fields are filled
//   • % documents available — share of required consent docs uploaded overall

import type { Student } from "@/components/StudentTable";

/** Grades these admission metrics apply to. */
export const ADMISSION_GRADES = [11, 12] as const;

/** True when a student's grade is tracked for admissions (grade 11 or 12). */
export function isAdmissionGrade(grade: number | null | undefined): boolean {
  return grade != null && (ADMISSION_GRADES as readonly number[]).includes(grade);
}

// Required consent document types, counted toward "% documents available".
//   parent_undertaking   → parent consent
//   wise_research_consent → WISE consent
// Edit this list to change which docs the documents metric expects.
export const CONSENT_REQUIRED_DOC_TYPES = [
  "parent_undertaking",
  "wise_research_consent",
] as const;

export type ConsentDocType = (typeof CONSENT_REQUIRED_DOC_TYPES)[number];

// Fields that count toward "info available" — the ones admissions actually
// collects, so the metric moves as PMs fill profiles in.
//
// This list was previously all 12 profile fields, which made the metric read
// ~0% everywhere and hid real progress. Measured fill rates across the grade
// 11/12 roster (~1.67L students) showed why:
//
//   first_name 100% · gender 100% · category 100% · district 98% · dob 83%
//   phone 82% · state 59% · last_name 56% · father_name 50%
//   mother_name 12% · pincode 5% · address 0.5%
//
// Because the check is all-or-nothing, address alone capped the metric at
// 0.5%. The fields below are the ones with real coverage, minus:
//   • last_name — ~44% of these students have no surname, so requiring it
//     penalises records that are in fact correct.
//   • district — 98% filled, but it is inherited from the school rather than
//     collected per student, so it would inflate the number without
//     reflecting any admissions work.
//
// Keyed against the Student shape so renames stay in sync. Editing this list
// is the supported way to change what "info complete" means.
export const INFO_REQUIRED_FIELDS = [
  "first_name",
  "phone",
  "gender",
  "date_of_birth",
  "category",
] as const satisfies readonly (keyof Student)[];

/** True when every INFO_REQUIRED_FIELDS value on the student is non-empty. */
export function isInfoComplete(student: Student): boolean {
  return INFO_REQUIRED_FIELDS.every((field) => {
    const value = student[field];
    return value != null && String(value).trim() !== "";
  });
}

/**
 * Map of `student_pk_id` → the required consent doc types currently present
 * for that student (a subset of CONSENT_REQUIRED_DOC_TYPES). Built by the
 * consent-status API route from the documents store.
 */
export type ConsentByStudentId = Record<string, ConsentDocType[]>;

export interface AdmissionSummary {
  /** Grade-11/12 roster size. */
  total: number;
  /** Students with all INFO_REQUIRED_FIELDS filled. */
  infoAvailable: number;
  /** infoAvailable / total, rounded to a whole percent (0 when total is 0). */
  infoAvailablePct: number;
  /**
   * Share of required consent docs uploaded across the roster, rounded to a
   * whole percent. Counts each (student × required doc) slot, so it moves as
   * partial consent comes in (not all-or-nothing per student).
   */
  docsAvailablePct: number;
}

export function buildAdmissionSummary(
  students: Student[],
  consentByStudentId: ConsentByStudentId,
): AdmissionSummary {
  const total = students.length;
  const requiredPerStudent = CONSENT_REQUIRED_DOC_TYPES.length;

  let infoAvailable = 0;
  let docSlotsFilled = 0;

  for (const student of students) {
    if (isInfoComplete(student)) infoAvailable++;

    const present = student.student_pk_id
      ? consentByStudentId[student.student_pk_id]
      : undefined;
    // Only count presence of *required* doc types toward the slot fill.
    if (present) {
      for (const type of CONSENT_REQUIRED_DOC_TYPES) {
        if (present.includes(type)) docSlotsFilled++;
      }
    }
  }

  const pct = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);

  return {
    total,
    infoAvailable,
    infoAvailablePct: pct(infoAvailable, total),
    docsAvailablePct: pct(docSlotsFilled, total * requiredPerStudent),
  };
}
