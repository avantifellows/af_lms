// The displayed "Phase N" of a Holistic Phase (issue #516). Client-safe: no database import.
//
// A Phase Plan is one ordered list across both Grades, but the number is per Grade:
// Grade 11 Phases are 1, 2, 3 and Grade 12 Phases are 4, 5, 6, each in Plan order.
// Every screen, export and query takes the number from here so they cannot disagree.

export const HOLISTIC_PHASES_PER_GRADE = 3;

type HolisticGrade = 11 | 12;

/** Phase N for the Phase at `placeInGrade` (1-based) among its Grade's Phases in Plan order. */
export function holisticPhaseNumber(grade: HolisticGrade, placeInGrade: number): number {
  return (grade === 12 ? HOLISTIC_PHASES_PER_GRADE : 0) + placeInGrade;
}

/** Adds `number` to the Phases of one Phase Plan. The Phases may be in any order. */
export function withHolisticPhaseNumbers<T extends { grade: HolisticGrade; position: number }>(
  phases: T[],
): Array<T & { number: number }> {
  return phases.map((phase) => ({
    ...phase,
    number: holisticPhaseNumber(
      phase.grade,
      phases.filter((other) => other.grade === phase.grade && other.position <= phase.position).length,
    ),
  }));
}

/**
 * The same number as an SQL expression, for queries that sort or page by it.
 * `phase` is the alias of a `holistic_mentorship_phases` row and `gradeNumber` an
 * expression for that row's Grade number. Both are fixed text from the calling query.
 */
export function holisticPhaseNumberSql(phase: string, gradeNumber: string): string {
  return `((SELECT COUNT(*)
            FROM holistic_mentorship_phases same_grade_phase
            WHERE same_grade_phase.phase_plan_id = ${phase}.phase_plan_id
              AND same_grade_phase.grade_id = ${phase}.grade_id
              AND same_grade_phase.position <= ${phase}.position)
           + CASE WHEN ${gradeNumber} = 12 THEN ${HOLISTIC_PHASES_PER_GRADE} ELSE 0 END)::int`;
}

export function holisticGradeFullError(grade: HolisticGrade): string {
  return `Grade ${grade} already has ${HOLISTIC_PHASES_PER_GRADE} Phases`;
}
