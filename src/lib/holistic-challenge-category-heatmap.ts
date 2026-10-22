import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { query } from "./db";
import {
  HOLISTIC_CHALLENGE_CATEGORIES,
  holisticChallengeCategoryPercent,
  type HolisticChallengeCategoryCode,
} from "./holistic-challenge-categories";
import { csvCell, getHolisticProgressAcademicYears } from "./holistic-progress";
import { buildHolisticSchoolScopePredicate } from "./holistic-scope";
import type { UserPermission } from "./permissions";
import type {
  ChallengeCategoryCounts,
  ChallengeCategoryHeatmap,
} from "@/types/holistic-challenge-category-heatmap";

export type { ChallengeCategoryHeatmap } from "@/types/holistic-challenge-category-heatmap";

// `allPrograms`: the viewer's scoped Holistic Programs at once (no Phases).
export type HolisticChallengeCategoryHeatmapFilters = {
  programIds: number[];
  allPrograms: boolean;
  academicYear: string;
  grade: 11 | 12;
  phaseId: number | null;
};

type HeatmapDatabaseRow = {
  row_kind: "total" | "school" | "hidden";
  school_code: string | null;
  school_name: string | null;
  category_code: string | null;
  students: number | string;
};

const CATEGORY_CODES = new Set<string>(HOLISTIC_CHALLENGE_CATEGORIES.map(({ code }) => code));

function emptyCounts(): ChallengeCategoryCounts {
  return Object.fromEntries(
    HOLISTIC_CHALLENGE_CATEGORIES.map(({ code }) => [code, 0]),
  ) as ChallengeCategoryCounts;
}

// One aggregation. A Student counts once per Category (union of codes across
// their qualifying Notes) under their latest in-scope Mapping School across the
// Programs; scope is applied before "latest wins", the Students & Progress
// transfer rule.
// Placeholders: $1 Programs, $2 Academic Year, $3 Grade, $4 Phase (null = All).
// The scope clause must use the `mapping_school` alias.
function heatmapSql(schoolScopeSql: string) {
  return `WITH heatmap_phases AS (
       SELECT phase.id
       FROM holistic_mentorship_phase_plans plan
       JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id
       JOIN grade phase_grade ON phase_grade.id = phase.grade_id
       WHERE plan.program_id = ANY($1::bigint[]) AND plan.academic_year = $2
         AND phase_grade.number = $3
         AND ($4::bigint IS NULL OR phase.id = $4)
     ), student_categories AS (
       SELECT DISTINCT notes.student_id, challenge.category_code::text AS category_code
       FROM holistic_mentorship_post_session_notes notes
       JOIN heatmap_phases ON heatmap_phases.id = notes.phase_id
       JOIN holistic_mentorship_post_session_note_challenges challenge ON challenge.notes_id = notes.id
       WHERE notes.state = 'submitted'
     ), scoped_mappings AS (
       SELECT mapping.id, mapping.student_id, mapping.school_id, mapping.started_at
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       JOIN school mapping_school ON mapping_school.id = mapping.school_id
       WHERE mapping.program_id = ANY($1::bigint[]) AND mapping.academic_year = $2
         ${schoolScopeSql}
     ), latest_mapping AS (
       SELECT DISTINCT ON (mapping.student_id) mapping.student_id, mapping.school_id
       FROM scoped_mappings mapping
       ORDER BY mapping.student_id, mapping.started_at DESC, mapping.id DESC
     ), counted AS (
       SELECT latest_mapping.school_id, student_categories.student_id, student_categories.category_code
       FROM student_categories
       JOIN latest_mapping ON latest_mapping.student_id = student_categories.student_id
     ), aggregated AS (
       SELECT counted.school_id, counted.category_code,
              GROUPING(counted.school_id) AS all_schools,
              COUNT(DISTINCT counted.student_id) AS students
       FROM counted
       GROUP BY GROUPING SETS ((counted.school_id, counted.category_code), (counted.school_id),
                               (counted.category_code), ())
     )
     SELECT CASE WHEN aggregated.all_schools = 1 THEN 'total' ELSE 'school' END AS row_kind,
            school.code AS school_code, school.name AS school_name,
            aggregated.category_code, aggregated.students
     FROM aggregated
     LEFT JOIN school ON school.id = aggregated.school_id
     UNION ALL
     SELECT 'hidden', school.code, school.name, NULL, 0
     FROM (SELECT DISTINCT school_id FROM scoped_mappings) mapping_school_ids
     JOIN school ON school.id = mapping_school_ids.school_id
     WHERE NOT EXISTS (SELECT 1 FROM counted WHERE counted.school_id = mapping_school_ids.school_id)`;
}

// The Grade's Phases in Plan order; `number` is the plan-wide Phase N.
// All Programs has no Phases: each Program has its own Phase Plan.
async function heatmapPhases(filters: HolisticChallengeCategoryHeatmapFilters) {
  if (filters.allPrograms) return [];
  const rows = await query<{ id: number | string; position: number; title: string; state: "open" | "locked" }>(
    `SELECT phase.id, phase.position, phase.title, phase.state
     FROM holistic_mentorship_phase_plans plan
     JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id
     JOIN grade phase_grade ON phase_grade.id = phase.grade_id
     WHERE plan.program_id = $1 AND plan.academic_year = $2 AND phase_grade.number = $3
     ORDER BY phase.position, phase.id`,
    [filters.programIds[0], filters.academicYear, filters.grade],
  );
  return rows.map((phase) => ({
    id: Number(phase.id), number: Number(phase.position), title: phase.title, state: phase.state,
  }));
}

function addCount(counts: ChallengeCategoryCounts, code: string, students: number) {
  if (CATEGORY_CODES.has(code)) counts[code as HolisticChallengeCategoryCode] = students;
}

function heatmapGrid(rows: HeatmapDatabaseRow[]) {
  const total = { studentCount: 0, counts: emptyCounts() };
  const schools = new Map<string, ChallengeCategoryHeatmap["schools"][number]>();
  let hiddenSchoolCount = 0;
  for (const row of rows) {
    const students = Number(row.students);
    if (row.row_kind === "hidden") {
      hiddenSchoolCount += 1;
      continue;
    }
    let target: { studentCount: number; counts: ChallengeCategoryCounts } = total;
    if (row.row_kind === "school") {
      const code = row.school_code ?? "";
      if (!schools.has(code)) {
        schools.set(code, { code, name: row.school_name ?? code, studentCount: 0, counts: emptyCounts() });
      }
      target = schools.get(code)!;
    }
    if (row.category_code === null) target.studentCount = students;
    else addCount(target.counts, row.category_code, students);
  }
  return {
    total,
    schools: [...schools.values()].sort((a, b) =>
      a.name.localeCompare(b.name) || a.code.localeCompare(b.code)),
    hiddenSchoolCount,
  };
}

// The union of each Program's Academic Years, current year first, then newest.
async function academicYearsAcross(programIds: number[], permission: UserPermission) {
  const perProgram = await Promise.all(
    programIds.map((programId) => getHolisticProgressAcademicYears(programId, permission)),
  );
  const years = new Set([CURRENT_ACADEMIC_YEAR, ...perProgram.flat()]);
  return [...years].sort((a, b) =>
    Number(b === CURRENT_ACADEMIC_YEAR) - Number(a === CURRENT_ACADEMIC_YEAR) || b.localeCompare(a));
}

// Null when `phaseId` is not a Phase of that Program, year and Grade's Plan
// (any Phase is invalid for All Programs).
export async function getHolisticChallengeCategoryHeatmap(
  filters: HolisticChallengeCategoryHeatmapFilters,
  permission: UserPermission,
): Promise<ChallengeCategoryHeatmap | null> {
  const phases = await heatmapPhases(filters);
  if (filters.phaseId !== null && !phases.some(({ id }) => id === filters.phaseId)) return null;
  const openPhases = phases.filter(({ state }) => state === "open");
  const schoolScope = buildHolisticSchoolScopePredicate(permission, {
    startIndex: 5,
    schoolCodeColumn: "mapping_school.code",
    schoolRegionColumn: "mapping_school.region",
  });
  const schoolScopeSql = schoolScope.clause ? `AND ${schoolScope.clause}` : "";
  const [rows, academicYears] = await Promise.all([
    query<HeatmapDatabaseRow>(heatmapSql(schoolScopeSql), [
      filters.programIds,
      filters.academicYear,
      filters.grade,
      filters.phaseId,
      ...schoolScope.params,
    ]),
    academicYearsAcross(filters.programIds, permission),
  ]);
  return {
    programIds: filters.programIds,
    academicYear: filters.academicYear,
    grade: filters.grade,
    phaseId: filters.phaseId,
    phases,
    defaultPhaseId: openPhases.at(-1)?.id ?? null,
    academicYears,
    ...heatmapGrid(rows),
  };
}

const CSV_GROUP_LABELS = { academic: "Academic", non_academic: "Non-academic" } as const;

// The visible grid as CSV: All Schools, then the n > 0 Schools in grid order.
// Percentages use the grid's helper, so both show the same one-decimal value.
export function formatHolisticChallengeCategoryHeatmapCsv(heatmap: ChallengeCategoryHeatmap): string {
  const header = [
    "School", "UDISE Code", "Students (n)",
    ...HOLISTIC_CHALLENGE_CATEGORIES.flatMap(({ group, label }) => [
      `${CSV_GROUP_LABELS[group]} - ${label} (count)`,
      `${CSV_GROUP_LABELS[group]} - ${label} (%)`,
    ]),
  ];
  const row = (name: string, code: string, studentCount: number, counts: ChallengeCategoryCounts) => [
    name, code, studentCount,
    ...HOLISTIC_CHALLENGE_CATEGORIES.flatMap(({ code: category }) => [
      counts[category],
      holisticChallengeCategoryPercent(counts[category], studentCount).toFixed(1),
    ]),
  ].map(csvCell).join(",");
  return [
    header.map(csvCell).join(","),
    row("All Schools", "", heatmap.total.studentCount, heatmap.total.counts),
    ...heatmap.schools.map((school) => row(school.name, school.code, school.studentCount, school.counts)),
  ].join("\r\n");
}
