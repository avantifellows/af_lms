// NVS Monthly Tests (#517, ADR 0014): which Papers form each Monthly Test, and
// its name. Server-only (Postgres). A Paper belongs to a Monthly Test when its
// `session` row is a System-wide Mandated Test for Grade 11 or 12 in the NVS
// auth group, switched on, and starts in the current academic year; Papers
// are grouped by the IST calendar month they start in, and the Monthly Test is
// named after that month. This is the only module that knows the rule, so a
// future PMU calendar can replace it behind the same function.
//
// Checked on production, 20 Nov 2026: the rule finds exactly the switched-on
// Papers of the PMU Firestore list it replaces (60 Papers, July to November),
// each in the same month.

import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { query } from "@/lib/db";
import { TEST_ATTENDANCE_GRADES, type TestSet } from "@/types/test-attendance";

/** `session.meta_data.group` of NVS sessions. */
export const NVS_AUTH_GROUP = "EnableStudents";
/** `session.meta_data.test_purpose` of a System-wide Mandated Test. */
export const MANDATED_TEST_PURPOSE = "system_wide_mandated";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The academic year "2026-2027" as IST wall-clock bounds: 1 Apr 2026 (in) to
 * 1 Apr 2027 (out). `session.start_time` holds IST wall clock, so the bounds
 * are compared as wall clock too.
 */
export function academicYearBounds(academicYear: string = CURRENT_ACADEMIC_YEAR): { from: string; to: string } {
  const match = /^(\d{4})-(\d{4})$/.exec(academicYear);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new Error(`Unexpected academic year: ${academicYear}`);
  }
  return { from: `${match[1]}-04-01 00:00:00`, to: `${match[2]}-04-01 00:00:00` };
}

interface PaperRow {
  platform_id: string;
  /** IST calendar month the Paper starts in, `YYYY-MM`. */
  month: string;
}

/**
 * Groups Papers (already ordered by start time) into Monthly Tests, one per
 * start month, oldest first. A quiz id goes to the month of its earliest row.
 */
export function testSetsFrom(rows: PaperRow[]): TestSet[] {
  const byMonth = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const quizId = row.platform_id.trim();
    if (!quizId || seen.has(quizId)) continue;
    seen.add(quizId);
    const list = byMonth.get(row.month) ?? [];
    list.push(quizId);
    byMonth.set(row.month, list);
  }
  return [...byMonth]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, quizIds]) => ({ label: MONTH_NAMES[Number(month.slice(5, 7)) - 1], quizIds }));
}

/**
 * The NVS Monthly Tests of the current academic year as `{label, quizIds}`,
 * oldest month first. Throws when the `session` read fails.
 */
export async function getNvsTestSets(): Promise<TestSet[]> {
  const { from, to } = academicYearBounds();
  const rows = await query<PaperRow>(
    `SELECT platform_id,
            to_char(start_time, 'YYYY-MM') AS month
       FROM session
      WHERE meta_data->>'test_purpose' = $1
        AND meta_data->>'group' = $2
        AND meta_data->>'grade' = ANY($3::text[])
        AND is_active = true
        AND start_time >= $4::timestamp
        AND start_time < $5::timestamp
        AND COALESCE(btrim(platform_id), '') <> ''
      ORDER BY start_time, platform_id`,
    [MANDATED_TEST_PURPOSE, NVS_AUTH_GROUP, TEST_ATTENDANCE_GRADES.map(String), from, to],
  );
  return testSetsFrom(rows);
}
