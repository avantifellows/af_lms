// Student support reads (Teacher View v2, af_lms #324): the Score journey for a
// grade and one student's report. BigQuery for results, Postgres for PYQ links.
// Every rule lives in student-support-rules.ts; this file only fetches and shapes.
import {
  DIM_STUDENT_TABLE,
  FACT_QUESTION_LEVEL_TABLE,
  FACT_TABLE,
  MAJOR_TEST_FORMATS,
  SUBMITTED_ONLY,
  getBigQueryClient,
  getCumulativeALData,
} from "./bigquery";
import { isAdvancedTest } from "./academic-level";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { query } from "./db";
import {
  alStatus,
  chapterFlag,
  examName,
  examStream,
  levelForTest,
  passMark,
  questionsToNext,
} from "./student-support-rules";
import type {
  ChapterRow,
  JourneyTest,
  TestResult,
  ExamChapters,
  ScoreJourneyData,
  ScoreJourneyRow,
  StudentReportData,
  TestHistoryRow,
  TestScore,
} from "@/types/student-support";

// Question -> live new-CMS chapter, both CMS generations (etl-next bridge_question_chapter).
const QUESTION_CHAPTER_TABLE = "`avantifellows.production_dbt_final.bridge_question_chapter`";
const CHAPTER_DIM_TABLE = "`avantifellows.production_dbt_final.dim_chapter`";
const CUTOFF_TABLE = "`avantifellows.production_dbt_final.dim_test_cutoffs`";

// Chapter competency counts answers from chapter tests as well as full tests.
const COMPETENCY_FORMATS = [...MAJOR_TEST_FORMATS, "chapter_test"];

// Baselines and dummy tests say nothing about chapters taught: left out of
// competency, as in the prototype. Matched by name; there is no flag for them.
const NOT_COMPETENCY = /baseline|dummy/i;

// Each stream sees only its own exams: NEET ↔ medical, JEE ↔ engineering.
const COURSES: Record<"engineering" | "medical", string[]> = {
  engineering: ["JEE Mains", "JEE Advanced"],
  medical: ["NEET"],
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const dateString = (v: unknown) =>
  typeof v === "string" ? v : ((v as { value?: string } | null)?.value ?? "");

interface StudentRaw {
  uid: string;
  student_id: string | null;
  name: string | null;
  gender: string | null;
  stream: string | null;
  category: string | null;
  mode_al: string | null;
  predicted_al: string | null;
  predicted_pct: number | null;
}

/** Enrolled students of one School + grade + program, from dim_student. */
async function getStudents(
  udise: string,
  grade: number,
  program: string,
  opts: { stream?: string; uid?: string } = {}
): Promise<StudentRaw[]> {
  const params: Record<string, string | number> = { udise, grade, program };
  if (opts.stream) params.stream = opts.stream;
  if (opts.uid) params.uid = Number(opts.uid);
  const sql = `
    SELECT
      CAST(enrollment_user_id AS STRING) AS uid,
      MAX(pk_student_id) AS student_id,
      ANY_VALUE(student_full_name) AS name,
      ANY_VALUE(student_gender) AS gender,
      ANY_VALUE(student_stream) AS stream,
      ANY_VALUE(student_category) AS category,
      MAX(academic_level) AS mode_al,
      MAX(predicted_academic_level) AS predicted_al,
      MAX(predicted_jee_percentile) AS predicted_pct
    FROM ${DIM_STUDENT_TABLE}
    WHERE student_school_udise_code = @udise
      AND student_grade = @grade
      AND student_program = @program
      AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
      AND student_status = 'Enrolled'
      ${opts.stream ? "AND LOWER(student_stream) = @stream" : ""}
      ${opts.uid ? "AND enrollment_user_id = @uid" : ""}
    GROUP BY enrollment_user_id
  `;
  const [rows] = await getBigQueryClient().query({ query: sql, params });
  return rows as StudentRaw[];
}

/**
 * Cutoff marks per stream + category + level, for the current year or the
 * latest earlier year that has them (the warehouse's own carry-forward rule).
 */
async function getCutoffs(): Promise<Map<string, number>> {
  const sql = `
    SELECT test_stream, category, academic_level, cutoff_marks
    FROM ${CUTOFF_TABLE}
    WHERE academic_year <= '${CURRENT_ACADEMIC_YEAR}'
      AND exam_name IN ('JEE Mains', 'NEET')
    QUALIFY academic_year = MAX(academic_year) OVER (PARTITION BY test_stream, exam_name)
  `;
  const [rows] = await getBigQueryClient().query({ query: sql });
  const map = new Map<string, number>();
  for (const r of rows as { test_stream: string; category: string; academic_level: string; cutoff_marks: number }[]) {
    map.set(cutoffKey(r.test_stream, r.category, r.academic_level), Number(r.cutoff_marks));
  }
  return map;
}

const cutoffKey = (stream: string, category: string, level: string) =>
  `${stream.toLowerCase()}|${category.trim().toLowerCase()}|${level}`;

type Progression = { marks: number; pct: number | null; level: string; test: string }[];

function journeyRow(
  s: StudentRaw,
  progression: Progression,
  cutoffs: Map<string, number>
): Omit<ScoreJourneyRow, "results"> {
  const stream = examStream(s.stream);
  const recent = progression.slice(-3);
  const latest = recent[recent.length - 1];
  return {
    uid: s.uid,
    studentId: s.student_id,
    name: s.name?.trim() || s.uid,
    gender: s.gender,
    category: s.category,
    examStream: stream,
    predicted: s.predicted_al,
    predictedPct: num(s.predicted_pct),
    mode: s.mode_al,
    status: alStatus(s.predicted_al, s.mode_al),
    last3: recent.map((p) => p.level),
    latestPct: latest ? round1(latest.pct) : null,
    toNext: questionsToNext(s.mode_al, recent, (level) =>
      stream && s.category ? (cutoffs.get(cutoffKey(stream, s.category, level)) ?? null) : null
    ),
  };
}

/**
 * Per student: the levelled full tests (Advanced excluded, the same tests that
 * decide dim_student.academic_level), oldest first, as marks + level, plus every
 * test's raw result for the "All tests" columns. The cumulative AL read already
 * returns exactly these, in order, and applies the test-grade filter.
 */
async function getProgressions(
  udise: string,
  grade: number,
  program: string,
  stream?: string,
  testGrade?: number
): Promise<{ tests: JourneyTest[]; byStudent: Map<string, { progression: Progression; results: Record<string, TestResult> }> }> {
  const data = await getCumulativeALData(udise, grade, program, stream, testGrade);
  const names = new Map(data.tests.map((t) => [t.session_id, t.test_name]));
  const byStudent = new Map<string, { progression: Progression; results: Record<string, TestResult> }>();
  for (const s of data.students) {
    const exam = examStream(s.stream);
    const progression: Progression = [];
    const results: Record<string, TestResult> = {};
    for (const p of s.progression) {
      results[p.session_id] = { level: p.academic_level, marks: p.marks_scored, max: p.max_marks_possible };
      const level = levelForTest(p.academic_level, exam);
      if (!level || p.marks_scored === null) continue;
      progression.push({
        marks: p.marks_scored,
        pct: p.max_marks_possible ? (p.marks_scored / p.max_marks_possible) * 100 : null,
        level,
        test: names.get(p.session_id) ?? p.session_id,
      });
    }
    byStudent.set(s.student_id, { progression, results });
  }
  const tests = data.tests.map((t) => ({ sessionId: t.session_id, name: t.test_name, date: t.start_date, stream: t.stream }));
  return { tests, byStudent };
}

export async function getScoreJourney(
  udise: string,
  grade: number,
  program: string,
  stream?: string,
  testGrade?: number
): Promise<ScoreJourneyData> {
  const [students, progressions, cutoffs] = await Promise.all([
    getStudents(udise, grade, program, { stream }),
    getProgressions(udise, grade, program, stream, testGrade),
    getCutoffs(),
  ]);
  return {
    tests: progressions.tests,
    students: students.map((s) => {
      const p = progressions.byStudent.get(s.uid);
      return { ...journeyRow(s, p?.progression ?? [], cutoffs), results: p?.results ?? {} };
    }),
  };
}

interface ChapterRaw {
  test_course: string;
  section: string;
  chapter_key: string;
  chapter_name: string | null;
  chapter_code: string | null;
  priority: string | null;
  n: number;
  attempted: number;
  correct: number;
  marks: number;
  max_marks: number;
  tests: number;
}

/**
 * One student's answers per exam × subject × chapter, summed across tests.
 * Each question's chapter comes from bridge_question_chapter: the new-CMS
 * question's own chapter, or for an old-CMS question its chapter in Vishal's
 * per-question tags. An old-CMS question without a tag has no chapter and is
 * left out (the chapter fact's old-CMS codes use an older numbering).
 * The question table is partitioned on hashed_session_id: naming the
 * student's own sessions reads only those partitions.
 */
async function getChapterRows(
  uid: string,
  stream: "engineering" | "medical",
  sessions: { id: string; hash: number }[]
): Promise<ChapterRaw[]> {
  if (sessions.length === 0) return [];
  const priority = stream === "medical" ? "priority_medical" : "priority_engineering";
  const sql = `
    WITH answers AS (
      SELECT session_id, test_course, section, question_source, question_source_id,
             is_answered, is_correct, marks_obtained, marking_scheme_correct
      FROM ${FACT_QUESTION_LEVEL_TABLE}
      WHERE hashed_session_id IN UNNEST(@hashes)
        AND session_id IN UNNEST(@sessions)
        AND enrollment_user_id = @uid
        AND test_course IN UNNEST(@courses)
        AND test_format IN UNNEST(@formats)
        AND section IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY session_id, question_id ORDER BY inserted_at_timestamp DESC) = 1
    )
    SELECT
      a.test_course,
      a.section,
      b.chapter_code AS chapter_key,
      ANY_VALUE(b.chapter_name) AS chapter_name,
      b.chapter_code,
      ANY_VALUE(c.${priority}) AS priority,
      COUNT(*) AS n,
      COUNTIF(a.is_answered) AS attempted,
      COUNTIF(a.is_correct = 1) AS correct,
      SUM(a.marks_obtained) AS marks,
      SUM(a.marking_scheme_correct) AS max_marks,
      COUNT(DISTINCT a.session_id) AS tests
    FROM answers a
    JOIN ${QUESTION_CHAPTER_TABLE} b
      ON b.question_source = a.question_source AND b.question_source_id = a.question_source_id
    LEFT JOIN ${CHAPTER_DIM_TABLE} c ON c.pk_chapter_id = b.fk_chapter_id
    GROUP BY a.test_course, a.section, b.chapter_code
  `;
  const [rows] = await getBigQueryClient().query({
    query: sql,
    params: {
      uid: Number(uid),
      courses: COURSES[stream],
      formats: COMPETENCY_FORMATS,
      hashes: [...new Set(sessions.map((x) => x.hash))],
      sessions: sessions.map((x) => x.id),
    },
  });
  return rows as ChapterRaw[];
}

/** PYQ document links per chapter code, from the CMS tables in Postgres. */
async function getPyqLinks(codes: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (codes.length === 0) return map;
  const rows = await query<{ code: string; url: string }>(
    `SELECT c.code, r.type_params->>'src_link' AS url
       FROM resource r
       JOIN resource_chapter rc ON rc.resource_id = r.id
       JOIN chapter c ON c.id = rc.chapter_id
      WHERE r.subtype = 'Previous Year Questions'
        AND r.type_params->>'src_link' IS NOT NULL
        AND c.code = ANY($1)`,
    [codes]
  );
  for (const r of rows) map.set(r.code, [...(map.get(r.code) ?? []), r.url]);
  return map;
}

function shapeChapters(rows: ChapterRaw[], pyq: Map<string, string[]>): ExamChapters[] {
  const exams = new Map<string, Map<string, ChapterRaw[]>>();
  for (const r of rows) {
    const exam = examName(r.test_course) ?? r.test_course;
    const subjects = exams.get(exam) ?? new Map<string, ChapterRaw[]>();
    subjects.set(r.section, [...(subjects.get(r.section) ?? []), r]);
    exams.set(exam, subjects);
  }
  return [...exams.entries()].map(([exam, subjects]) => ({
    exam,
    subjects: [...subjects.entries()]
      .map(([subject, raws]) => {
        const pass = passMark(exam, subject);
        let answers = 0;
        let attempted = 0;
        let correct = 0;
        const chapters: ChapterRow[] = raws.map((r) => {
          const n = Number(r.n) || 0;
          const att = Number(r.attempted) || 0;
          const cor = Number(r.correct) || 0;
          answers += n;
          attempted += att;
          correct += cor;
          const c = {
            n,
            attempt: round1(pct(att, n)),
            accuracy: round1(pct(cor, att)),
            score: round1(pct(Number(r.marks) || 0, Number(r.max_marks) || 0)),
          };
          return {
            key: r.chapter_key,
            code: r.chapter_code,
            name: r.chapter_name ?? r.chapter_key,
            priority: r.priority,
            ...c,
            tests: Number(r.tests) || 0,
            flag: chapterFlag(c, pass),
            pyq: r.chapter_code ? (pyq.get(r.chapter_code) ?? []) : [],
          };
        });
        return {
          subject,
          passMark: pass,
          answers,
          attempt: round1(pct(attempted, answers)),
          accuracy: round1(pct(correct, attempted)),
          chapters,
        };
      })
      .sort((a, b) => a.subject.localeCompare(b.subject)),
  }));
}

interface TestRaw {
  session_id: string;
  test_name: string;
  start_date: unknown;
  test_course: string | null;
  test_format: string | null;
  hashed_session_id: number | null;
  section: string | null;
  marks_scored: number | null;
  max_marks_possible: number | null;
  percentage: number | null;
  num_correct: number | null;
  num_wrong: number | null;
  num_partially_correct: number | null;
  num_skipped: number | null;
  academic_level: string | null;
  centre_rank: number | null;
  takers: number | null;
}

/**
 * Every full or chapter test the student's School + grade + program sat in the
 * student's stream, with the student's result per section (none = absent) and
 * their rank among the School's students. Full tests make the test history;
 * the sessions the student sat also scope the chapter read.
 */
async function getTestRows(
  udise: string,
  grade: number,
  program: string,
  uid: string,
  stream: "engineering" | "medical"
): Promise<TestRaw[]> {
  const formats = COMPETENCY_FORMATS.map((f) => `'${f}'`).join(",");
  const sql = `
    WITH results AS (
      SELECT
        CAST(enrollment_user_id AS STRING) AS uid, session_id, hashed_session_id, test_name,
        start_date, test_course, test_format, test_stream, section, marks_scored, max_marks_possible, percentage,
        num_correct, num_wrong, num_partially_correct, num_skipped, academic_level
      FROM ${FACT_TABLE}
      WHERE student_school_udise_code = @udise
        AND student_grade = @grade
        AND student_program = @program
        AND academic_year = '${CURRENT_ACADEMIC_YEAR}'
        AND test_format IN (${formats})
        AND session_id IS NOT NULL
        AND (test_stream IS NULL OR LOWER(test_stream) = @stream)
        ${SUBMITTED_ONLY}
    ),
    tests AS (
      SELECT session_id, ANY_VALUE(hashed_session_id) AS hashed_session_id,
             ANY_VALUE(test_name) AS test_name, MIN(start_date) AS start_date,
             ANY_VALUE(test_course) AS test_course, ANY_VALUE(test_format) AS test_format
      FROM results GROUP BY session_id
    ),
    ranked AS (
      SELECT uid, session_id,
             RANK() OVER (PARTITION BY session_id ORDER BY marks_scored DESC) AS centre_rank,
             COUNT(*) OVER (PARTITION BY session_id) AS takers
      FROM results WHERE LOWER(section) = 'overall'
    )
    SELECT t.session_id, t.hashed_session_id, t.test_name, t.start_date, t.test_course, t.test_format,
           r.section, r.marks_scored, r.max_marks_possible, r.percentage, r.num_correct,
           r.num_wrong, r.num_partially_correct, r.num_skipped, r.academic_level,
           k.centre_rank, k.takers
    FROM tests t
    LEFT JOIN results r ON r.session_id = t.session_id AND r.uid = @uid
    LEFT JOIN ranked k ON k.session_id = t.session_id AND k.uid = @uid
    ORDER BY t.start_date DESC
  `;
  const [rows] = await getBigQueryClient().query({
    query: sql,
    params: { udise, grade, program, uid, stream },
  });
  return rows as TestRaw[];
}

function score(r: TestRaw): TestScore {
  return {
    marks: num(r.marks_scored),
    max: num(r.max_marks_possible),
    pct: round1(num(r.percentage)),
    correct: num(r.num_correct),
    wrong: num(r.num_wrong),
    partial: num(r.num_partially_correct),
    skipped: num(r.num_skipped),
  };
}

const isFullTest = (r: TestRaw) => MAJOR_TEST_FORMATS.includes(r.test_format ?? "");

function shapeTests(rows: TestRaw[]): TestHistoryRow[] {
  const bySession = new Map<string, TestHistoryRow>();
  for (const r of rows.filter(isFullTest)) {
    const row = bySession.get(r.session_id) ?? {
      sessionId: r.session_id,
      name: r.test_name,
      date: dateString(r.start_date),
      exam: examName(r.test_course),
      absent: true,
      level: null,
      rank: null,
      takers: null,
      overall: null,
      subjects: [],
      change: null,
    };
    if (r.section) {
      row.absent = false;
      if (r.section.toLowerCase() === "overall") {
        row.overall = score(r);
        row.level = r.academic_level;
        row.rank = num(r.centre_rank);
        row.takers = num(r.takers);
      } else {
        row.subjects.push({ subject: r.section, ...score(r) });
      }
    }
    bySession.set(r.session_id, row);
  }
  const tests = [...bySession.values()].sort((a, b) => b.date.localeCompare(a.date));
  // Change vs the previous sitting of the same exam the student actually sat.
  const previous = new Map<string, number>();
  for (const t of [...tests].reverse()) {
    const key = t.exam ?? "";
    const p = t.overall?.pct ?? null;
    if (p === null) continue;
    const before = previous.get(key);
    t.change = before === undefined ? null : round1(p - before);
    previous.set(key, p);
  }
  for (const t of tests) t.subjects.sort((a, b) => a.subject.localeCompare(b.subject));
  return tests;
}

/**
 * The student's levelled full tests, oldest first: the same tests the
 * cumulative AL read gives the Score journey (Advanced excluded), taken from
 * rows the report already has rather than a second scan.
 */
function progressionFromTests(rows: TestRaw[], stream: "engineering" | "medical" | null): Progression {
  return rows
    .filter((r) => isFullTest(r) && r.section?.toLowerCase() === "overall" && !isAdvancedTest(r.test_name))
    .map((r) => ({ r, level: r.academic_level ? levelForTest(r.academic_level, stream) : null, date: dateString(r.start_date) }))
    .filter((x): x is { r: TestRaw; level: string; date: string } => !!x.level && x.r.marks_scored !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ r, level }) => ({
      marks: Number(r.marks_scored),
      pct: r.max_marks_possible ? (Number(r.marks_scored) / Number(r.max_marks_possible)) * 100 : null,
      level,
      test: r.test_name,
    }));
}

/** One student's report, or null when they are not an enrolled student of
 *  this School + grade + program (the caller answers 404). */
export async function getStudentReport(
  udise: string,
  grade: number,
  program: string,
  uid: string
): Promise<StudentReportData | null> {
  const [student] = await getStudents(udise, grade, program, { uid });
  if (!student) return null;
  const stream = examStream(student.stream);
  const [cutoffs, testRows] = await Promise.all([
    getCutoffs(),
    stream ? getTestRows(udise, grade, program, uid, stream) : Promise.resolve([]),
  ]);
  const sat = new Map<string, number>();
  for (const r of testRows) {
    if (r.section && r.hashed_session_id !== null && !NOT_COMPETENCY.test(r.test_name)) {
      sat.set(r.session_id, Number(r.hashed_session_id));
    }
  }
  const chapterRows = stream
    ? await getChapterRows(uid, stream, [...sat].map(([id, hash]) => ({ id, hash })))
    : [];
  const codes = [...new Set(chapterRows.map((r) => r.chapter_code).filter((c): c is string => !!c))];
  const pyq = await getPyqLinks(codes);
  return {
    student: { ...journeyRow(student, progressionFromTests(testRows, stream), cutoffs), results: {} },
    chapters: shapeChapters(chapterRows, pyq),
    tests: shapeTests(testRows),
  };
}
