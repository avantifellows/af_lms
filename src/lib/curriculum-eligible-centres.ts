// Eligible Centres (#417): the one rule for which Centres can hold a Curriculum Plan, and the
// Summary Classes the Curriculum Summary shows. An eligible Centre is an active, physical Centre at
// a JNV School, with a Centre Exam Track mapped for the Grade. Plan assignment and the Summary both
// build their queries from these fragments, so the Centres you can assign and the Centres the
// Summary lists stay the same set.
//
// The fragments are static SQL with no values in them. Callers interpolate them and pass every
// value through `$n` placeholders.

import type { Db } from "./curriculum-plans";

// FROM-clause body: Centres (`c`), their School (`s`) and their Centre Exam Tracks (`cet`). One row
// per Centre + mapped track + Grade. The caller narrows `cet.grade_id` to the Grade(s) it wants.
export const ELIGIBLE_CENTRE_TRACKS_FROM_SQL = `centres c
       JOIN school s ON s.id = c.school_id
       JOIN centre_exam_tracks cet ON cet.centre_id = c.id`;

// WHERE predicate over `c` and `s`: an active, physical Centre at a JNV School.
export const ELIGIBLE_CENTRE_SQL = `c.is_active = true
       AND c.is_physical = true
       AND s.af_school_category = 'JNV'`;

// Grades are matched by id (a plan's own Grade) or by number (Grades 11 and 12).
export type TracksWithContentGrades = { gradeIds: number[] } | { gradeNumbers: readonly number[] };

// The Exam Tracks with content for each Grade, keyed by Grade number. A track has content when
// the Grade has at least one in-syllabus LMS Chapter Exam Config for it.
export async function loadTracksWithContent(
  db: Db,
  grades: TracksWithContentGrades
): Promise<Map<number, string[]>> {
  const rows = await db<{ grade: string | number; exam_track: string }>(
    `SELECT DISTINCT g.number AS grade, cfg.exam_track
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     WHERE cfg.is_in_syllabus = true
       AND ($1::bigint[] IS NULL OR ch.grade_id = ANY($1::bigint[]))
       AND ($2::integer[] IS NULL OR g.number = ANY($2::integer[]))`,
    [
      "gradeIds" in grades ? grades.gradeIds : null,
      "gradeNumbers" in grades ? grades.gradeNumbers : null,
    ]
  );
  const byGrade = new Map<number, string[]>();
  for (const row of rows) {
    const grade = Number(row.grade);
    byGrade.set(grade, [...(byGrade.get(grade) ?? []), row.exam_track]);
  }
  return byGrade;
}
