// Admission readiness metrics (grades 11 & 12).
//
// Tracks, per school, how far admissions have progressed for each grade:
//   • total students        — grade-11 roster size
//   • reported              — students whose admission is complete (all the
//                             required consent docs uploaded on the LMS)
//   • % info available      — students whose core profile fields are filled
//   • % documents available — share of required consent docs uploaded overall
//
// "Reported" uses consent uploads as a proxy because admission is only
// considered complete once consent is on the LMS (confirmed with Vishal,
// 2026-06-05). The required consent set is parent consent + WISE consent.

import type { Student } from "@/components/StudentTable";

/** Grades these admission metrics apply to. */
export const ADMISSION_GRADES = [11, 12] as const;

/** True when a student's grade is tracked for admissions (grade 11 or 12). */
export function isAdmissionGrade(grade: number | null | undefined): boolean {
  return grade != null && (ADMISSION_GRADES as readonly number[]).includes(grade);
}

// Document types that together mark a student as "reported" / admitted.
//   parent_undertaking   → parent consent
//   wise_research_consent → WISE consent
// Both must be present. Edit this list to change what "reported" requires.
export const CONSENT_REQUIRED_DOC_TYPES = [
  "parent_undertaking",
  "wise_research_consent",
] as const;

export type ConsentDocType = (typeof CONSENT_REQUIRED_DOC_TYPES)[number];

// Fields that count toward "info available". There is no product-defined
// required-field rule yet, so this is a sensible default — adjust the list to
// change the metric. Keyed against the Student shape so renames stay in sync.
export const INFO_REQUIRED_FIELDS = [
  "first_name",
  "last_name",
  "phone",
  "gender",
  "date_of_birth",
  "category",
  "father_name",
  "mother_name",
  "address",
  "state",
  "district",
  "pincode",
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

/** A student is reported once all required consent docs are present. */
export function isReported(present: readonly string[] | undefined): boolean {
  if (!present) return false;
  return CONSENT_REQUIRED_DOC_TYPES.every((type) => present.includes(type));
}

/** Required consent doc types that are still missing for a student. */
export function missingConsentDocs(
  present: readonly string[] | undefined,
): ConsentDocType[] {
  const have = new Set(present ?? []);
  return CONSENT_REQUIRED_DOC_TYPES.filter((type) => !have.has(type));
}

export interface AdmissionSummary {
  /** Grade-11 roster size. */
  total: number;
  /** Students with all required consent docs uploaded. */
  reported: number;
  /** Students with all INFO_REQUIRED_FIELDS filled. */
  infoAvailable: number;
  /** infoAvailable / total, rounded to a whole percent (0 when total is 0). */
  infoAvailablePct: number;
  /**
   * Share of required consent docs uploaded across the roster, rounded to a
   * whole percent. Counts each (student × required doc) slot, so it moves as
   * partial consent comes in — distinct from `reported`, which needs all docs.
   */
  docsAvailablePct: number;
}

export function buildAdmissionSummary(
  students: Student[],
  consentByStudentId: ConsentByStudentId,
): AdmissionSummary {
  const total = students.length;
  const requiredPerStudent = CONSENT_REQUIRED_DOC_TYPES.length;

  let reported = 0;
  let infoAvailable = 0;
  let docSlotsFilled = 0;

  for (const student of students) {
    if (isInfoComplete(student)) infoAvailable++;

    const present = student.student_pk_id
      ? consentByStudentId[student.student_pk_id]
      : undefined;
    if (isReported(present)) reported++;
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
    reported,
    infoAvailable,
    infoAvailablePct: pct(infoAvailable, total),
    docsAvailablePct: pct(docSlotsFilled, total * requiredPerStudent),
  };
}
