// Alumni tab — who counts as "to add" and which programs are tracked.
//
// "To add" = anyone who has passed out (their last Grade 12 year is before the
// current academic year and they're in no class this year), was in one of
// these programs in their Grade 12 year, isn't a dropout, and has no alumni
// row yet. Every past year counts, so nothing changes when a new year starts.
// JNV NVS is deliberately excluded (govt-scale programme, not tracked one by one).

export const ALUMNI_COHORT_GRADE = 12;

/** The Indian academic year starts in April. */
const ACADEMIC_YEAR_START_MONTH = 4;
/** India Standard Time is UTC+5:30 (no daylight saving). */
const IST_OFFSET_MS = 330 * 60 * 1000;

/**
 * The academic year running on `now` in India, e.g. "2026-2027" for April
 * 2026 – March 2027. Uses IST, not the server's clock, so a UTC server flips
 * at midnight IST on 1 April, not at 05:30.
 */
export function currentAcademicYear(now = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() + 1 >= ACADEMIC_YEAR_START_MONTH ? year : year - 1;
  return `${start}-${start + 1}`;
}

/** "2025-2026" → "2026". */
export const academicYearEnd = (academicYear: string) => academicYear.split("-")[1] ?? "";

/**
 * Alumni programs (program.id), in attribution order: a student in more than
 * one is counted under the first — CoE before Nodal, like PROGRAM_ATTRIBUTION_ORDER.
 * 1 JNV CoE · 86 Dakshana CoE · 87 ENF CoE · 74 Punjab CoE · 2 JNV Nodal · 94 Punjab Nodal.
 * Punjab pass-outs can be under either Punjab program (production has
 * 2025-26 Grade 12 under Punjab CoE; staging under Punjab Nodal).
 */
export const ALUMNI_PROGRAM_ORDER = [1, 86, 87, 74, 2, 94];
