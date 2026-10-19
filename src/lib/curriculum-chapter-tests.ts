// Chapter Test Status loader (#417 / #428): the chapter-test quiz sessions teachers already
// create, attributed to Summary Classes and Chapters. Read-only and straight from Postgres;
// sessions are never written. Statuses come from `chapterTestStatus` in
// `curriculum-plan-rules`, so the Summary and the chapter timeline share one rule.

import { chapterSharesCodeSql } from "./chapter-siblings";
import { cmsTestIdSql } from "./cms-tests";
import { academicYearStartDate } from "./curriculum-plan-rules";
import { query } from "./db";

// Centre id → Chapter id → end times (IST wall clock, `YYYY-MM-DD HH:mm:ss`; null = no end
// time) of the sessions counted for that Centre's class and Chapter. Duplicate Chapter rows
// sharing code + subject + Grade all carry the session, so any plan Chapter id finds it.
export type ChapterTestSessions = Map<number, Map<number, (string | null)[]>>;

export async function loadChapterTestSessions(params: {
  centreIds: number[];
  grade: number;
  academicYear: string;
}): Promise<ChapterTestSessions> {
  const byCentre: ChapterTestSessions = new Map();
  if (params.centreIds.length === 0) return byCentre;

  const rows = await query<{ centre_id: string | number; chapter_id: string | number; end_time: string | null }>(
    CHAPTER_TEST_SESSIONS_SQL,
    [params.centreIds, params.grade, academicYearStartDate(params.academicYear)]
  );
  for (const row of rows) {
    const centreId = Number(row.centre_id);
    const chapters = byCentre.get(centreId) ?? new Map<number, (string | null)[]>();
    const chapterId = Number(row.chapter_id);
    chapters.set(chapterId, [...(chapters.get(chapterId) ?? []), row.end_time]);
    byCentre.set(centreId, chapters);
  }
  return byCentre;
}

// $1 Centre ids, $2 Grade number, $3 1 Apr of the academic year.
//
// Sessions: active new-CMS quiz sessions with test_format 'chapter_test' (so not
// 'combined_chapter_test'), not failed, for the Grade, starting on or after 1 Apr.
//
// Class: each comma-separated meta_data.batch_id → batch → school_batch → School, and the
// batch's Program → the Centre at that School with that Program. A session whose batches span
// several Centres counts for each.
//
// Chapter, in order: the CMS test's first type_params.chapter_id; else the majority
// resource_chapter of the test's problems; else the Chapter code leading the session or test
// name ("12C17 - …").
const CHAPTER_CODE_PATTERN = "^\\s*([A-Za-z0-9-]*[0-9][A-Za-z0-9-]*)\\s+-\\s";

const CHAPTER_TEST_SESSIONS_SQL = `
  WITH chapter_test_sessions AS (
    SELECT
      s.id,
      s.name,
      s.meta_data,
      s.end_time,
      ${cmsTestIdSql("s.meta_data")} AS cms_test_id
    FROM session s
    WHERE s.platform = 'quiz'
      AND s.is_active = true
      AND s.meta_data->>'cms_source' = 'nex-gen-cms'
      AND s.meta_data->>'test_format' = 'chapter_test'
      AND s.meta_data->>'status' IS DISTINCT FROM 'failed'
      AND s.meta_data->>'grade' = $2::int::text
      AND s.start_time >= $3::date
  ),
  session_centres AS (
    SELECT DISTINCT cts.id AS session_id, c.id AS centre_id
    FROM chapter_test_sessions cts
    CROSS JOIN LATERAL unnest(string_to_array(cts.meta_data->>'batch_id', ',')) AS listed(batch_code)
    JOIN batch b ON b.batch_id = btrim(listed.batch_code)
    JOIN school_batch sb ON sb.batch_id = b.id
    JOIN centres c ON c.school_id = sb.school_id AND c.program_id = b.program_id
    WHERE c.id = ANY($1::int[])
  ),
  session_chapters AS (
    SELECT
      cts.id AS session_id,
      cts.end_time,
      COALESCE(
        (
          SELECT ch.id
          FROM resource r
          JOIN chapter ch
            ON ch.id::text = COALESCE(r.type_params->'chapter_id'->>0, r.type_params->>'chapter_id')
          WHERE r.id = cts.cms_test_id
        ),
        (
          SELECT rc.chapter_id
          FROM resource r
          CROSS JOIN LATERAL jsonb_path_query(
            r.type_params, 'lax $.subjects[*].sections[*].*.problems[*].id'
          ) AS p(problem_id)
          JOIN resource_chapter rc
            ON rc.resource_id = CASE
              WHEN (p.problem_id #>> '{}') ~ '^[0-9]+$' THEN (p.problem_id #>> '{}')::bigint
            END
          WHERE r.id = cts.cms_test_id
            AND rc.chapter_id IS NOT NULL
          GROUP BY rc.chapter_id
          ORDER BY COUNT(*) DESC, rc.chapter_id
          LIMIT 1
        ),
        (
          SELECT ch.id
          FROM chapter ch
          JOIN grade g ON g.id = ch.grade_id AND g.number = $2::int
          WHERE ch.code = COALESCE(
            substring(cts.name from '${CHAPTER_CODE_PATTERN}'),
            substring(cts.meta_data->>'test_name' from '${CHAPTER_CODE_PATTERN}')
          )
          ORDER BY ch.id
          LIMIT 1
        )
      ) AS chapter_id
    FROM chapter_test_sessions cts
    WHERE EXISTS (SELECT 1 FROM session_centres sc WHERE sc.session_id = cts.id)
  )
  SELECT DISTINCT
    sc.centre_id,
    sib.id AS chapter_id,
    sch.session_id,
    to_char(sch.end_time, 'YYYY-MM-DD HH24:MI:SS') AS end_time
  FROM session_chapters sch
  JOIN session_centres sc ON sc.session_id = sch.session_id
  JOIN chapter attributed ON attributed.id = sch.chapter_id
  JOIN chapter sib
    ON sib.id = attributed.id
    OR (${chapterSharesCodeSql("attributed", "sib")})`;
