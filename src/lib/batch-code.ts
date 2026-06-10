import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

// Batch codes encode grade and stream as free-form tokens, and the naming
// convention has drifted across cohorts:
//   EnableStudents_11_Photon_Eng_24_N017  → grade token "11", stream "_Eng_"
//   EnableStudents_12_25_Engg_C08         → grade token "12", stream "_Engg_"
//   EnableStudents_TP_2028_eng_C029       → no grade token; cohort passing
//                                           year "2028", stream "_eng_"
// Parse all known variants. This is a stopgap until grade/stream live in
// batch.metadata (NVS batches already store them there; CoE/Nodal don't).

const VALID_GRADES = new Set([9, 10, 11, 12]);

export function parseBatchGrade(
  batchId: string,
  academicYear: string = CURRENT_ACADEMIC_YEAR
): number | null {
  const parts = batchId.split("_");

  // Legacy codes carry the grade as a standalone numeric token.
  for (const part of parts) {
    if (/^\d{1,2}$/.test(part) && VALID_GRADES.has(Number(part))) {
      return Number(part);
    }
  }

  // TP-style codes carry the cohort's passing year instead: a cohort passing
  // in YYYY is in grade 12 during the academic year that ends in YYYY, grade
  // 11 the year before, and so on.
  const passingYear = parts.find((part) => /^20\d{2}$/.test(part));
  if (passingYear) {
    const academicYearEnd = Number(academicYear.split("-")[1]);
    if (!Number.isFinite(academicYearEnd)) return null;
    const grade = 12 - (Number(passingYear) - academicYearEnd);
    return VALID_GRADES.has(grade) ? grade : null;
  }

  return null;
}

export function parseBatchStream(batchId: string): string {
  if (/_engg?_/i.test(batchId)) return "engineering";
  if (/_med_/i.test(batchId)) return "medical";
  return "";
}
