// Paper windows for the Test Attendance tab (#517): each Paper's opening and
// closing time, grade and on/off state from the LMS `session` table, matched
// on the quiz id (`platform_id`). Server-only (Postgres).
//
// Checked on production, 18 Nov 2026: all 49 quiz ids in the PMU test set
// list have exactly one `session` row, `platform_id` holds the quiz id and
// `meta_data.grade` is always set. The rules below still tolerate several
// rows, no row, and missing values.

import { query } from "@/lib/db";
import { dbIstTimestampToUtcIso } from "@/lib/quiz-session-time";
import type { PaperWindow } from "@/types/test-attendance";

interface SessionRow {
  platform_id: string;
  start_time: string | null;
  end_time: string | null;
  grade: string | null;
  is_active: boolean | null;
}

/** `session.start_time`/`end_time` hold IST wall clock; null when missing or unreadable. */
function istToUtc(value: string | null): string | null {
  if (!value) return null;
  try {
    return dbIstTimestampToUtcIso(value) || null;
  } catch {
    return null;
  }
}

function toGrade(value: string | null): number | null {
  const grade = Number(value);
  return value != null && value.trim() !== "" && Number.isInteger(grade) ? grade : null;
}

const earliest = (values: (string | null)[]) =>
  values.reduce<string | null>((min, v) => (v != null && (min == null || Date.parse(v) < Date.parse(min)) ? v : min), null);
const latest = (values: (string | null)[]) =>
  values.reduce<string | null>((max, v) => (v != null && (max == null || Date.parse(v) > Date.parse(max)) ? v : max), null);

/**
 * One window per quiz id that has a `session` row. When several rows share a
 * quiz id, the switched-on rows give the earliest opening, the latest closing
 * and the grade; with none switched on the Paper is reported switched off.
 * The rules module skips switched-off Papers and Papers without both times.
 */
export async function readPaperWindows(quizIds: string[]): Promise<PaperWindow[]> {
  if (quizIds.length === 0) return [];
  const rows = await query<SessionRow>(
    `SELECT platform_id,
            start_time::text AS start_time,
            end_time::text AS end_time,
            meta_data->>'grade' AS grade,
            is_active
       FROM session
      WHERE platform_id = ANY($1::text[])
      ORDER BY platform_id, start_time NULLS LAST, id`,
    [quizIds],
  );

  const byQuizId = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const list = byQuizId.get(row.platform_id) ?? [];
    list.push(row);
    byQuizId.set(row.platform_id, list);
  }

  return [...byQuizId].map(([quizId, all]) => {
    // A null is_active counts as switched on, as the quiz-session list reads it.
    const on = all.filter((row) => row.is_active !== false);
    const used = on.length > 0 ? on : all;
    return {
      quizId,
      opensAt: earliest(used.map((row) => istToUtc(row.start_time))),
      closesAt: latest(used.map((row) => istToUtc(row.end_time))),
      grade: used.map((row) => toGrade(row.grade)).find((grade) => grade != null) ?? null,
      switchedOn: on.length > 0,
    };
  });
}
