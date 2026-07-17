import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "./constants";
import { query } from "./db";
import type { HolisticProgress, HolisticProgressRow } from "@/types/holistic-progress";

export type { HolisticProgress, HolisticProgressRow } from "@/types/holistic-progress";
export type HolisticProgressSort = "student_name" | "school" | "grade" | "mentor" | "phase" | "progress";
export type HolisticProgressDirection = "asc" | "desc";

export type HolisticProgressFilters = {
  academicYear: string;
  phaseId: number | null;
  schoolCode: string | null;
  grade: 11 | 12 | null;
  mentorUserId: number | null;
  progress: HolisticProgress | null;
  search: string;
  sort: HolisticProgressSort;
  direction: HolisticProgressDirection;
  page: number;
};

export type HolisticProgressOptions = {
  schools: Array<{ code: string; name: string }>;
  mentors: Array<{ userId: number; name: string }>;
  phases: Array<{ id: number; number: number; title: string; grade: 11 | 12; state: "open" | "locked" }>;
};

type ProgressDatabaseRow = {
  student_id: number | string | null;
  student_name: string | null;
  external_student_id: string | null;
  grade: number | string;
  school_name: string;
  school_code: string;
  mentor_name: string | null;
  mentor_email: string | null;
  phase_id: number | string | null;
  phase_number: number | string | null;
  phase_title: string | null;
  phase_state: "open" | "locked" | null;
  progress: HolisticProgress;
  completed_at: string | null;
  notes_author: string | null;
  notes_last_edited_at: string | null;
  answers: unknown;
  total_mapped: number | string;
  pending_count: number | string;
  completed_count: number | string;
  skipped_count: number | string;
  no_active_phase_count: number | string;
};

const SORT_SQL: Record<HolisticProgressSort, string> = {
  student_name: "student_name",
  school: "school_name",
  grade: "grade",
  mentor: "mentor_name",
  phase: "phase_number",
  progress: "progress",
};

function parsedAnswers(value: unknown): HolisticProgressRow["answers"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((answer) => {
    if (!answer || typeof answer !== "object") return [];
    const item = answer as Record<string, unknown>;
    return typeof item.question === "string" && typeof item.answer === "string"
      ? [{ position: Number(item.position), question: item.question, answer: item.answer }]
      : [];
  });
}

export async function listHolisticProgress(
  filters: HolisticProgressFilters,
  options: { all?: boolean } = {}
): Promise<{
  rows: HolisticProgressRow[];
  counts: { totalMapped: number; pending: number; completed: number; skipped: number; noActivePhase: number };
}> {
  const direction = filters.direction === "desc" ? "DESC" : "ASC";
  const order = `${SORT_SQL[filters.sort]} ${direction} NULLS LAST, student_name ASC NULLS LAST, external_student_id ASC NULLS LAST, student_id ASC`;
  const limit = options.all ? null : 50;
  const offset = options.all ? 0 : (filters.page - 1) * 50;
  const rows = await query<ProgressDatabaseRow>(
    `WITH mapped AS (
       SELECT DISTINCT ON (mapping.student_id)
              mapping.student_id, mapping.school_id, mapping.mentor_user_id,
              mapping.started_at, mapping.id AS mapping_id
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       WHERE mapping.program_id = $1 AND mapping.academic_year = $2
         AND ($2 <> $11 OR mapping.ended_at IS NULL)
       ORDER BY mapping.student_id, mapping.started_at DESC, mapping.id DESC
     ), base AS (
       SELECT mapped.*, school.name AS school_name, school.code AS school_code,
              st.student_id AS external_student_id,
              NULLIF(TRIM(COALESCE(student_user.first_name, '') || ' ' || COALESCE(student_user.last_name, '')), '') AS student_name,
              grade.number AS grade,
              NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS mentor_name,
              mentor.email AS mentor_email,
              selected_phase.id AS phase_id, selected_phase.position AS phase_number,
              selected_phase.title AS phase_title, selected_phase.state AS phase_state,
              initial_active.position AS initial_active_position
       FROM mapped
       JOIN school ON school.id = mapped.school_id
       JOIN student st ON st.id = mapped.student_id
       JOIN "user" student_user ON student_user.id = st.user_id
       JOIN "user" mentor ON mentor.id = mapped.mentor_user_id
       JOIN LATERAL (
         SELECT grade.number
         FROM enrollment_record grade_enrollment
         JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number IN (11, 12)
         WHERE grade_enrollment.user_id = student_user.id
           AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = $2
         ORDER BY grade_enrollment.is_current DESC, grade_enrollment.id DESC LIMIT 1
       ) grade ON true
       LEFT JOIN LATERAL (
         SELECT phase.id, phase.position, phase.title, phase.state
         FROM holistic_mentorship_phase_plans plan
         JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id
         JOIN grade phase_grade ON phase_grade.id = phase.grade_id AND phase_grade.number = grade.number
         WHERE plan.program_id = $1 AND plan.academic_year = $2
           AND (($3::bigint IS NULL AND phase.state = 'open') OR phase.id = $3)
         ORDER BY CASE WHEN phase.id = $3 THEN 0 ELSE 1 END, phase.position DESC
         LIMIT 1
       ) selected_phase ON true
       LEFT JOIN LATERAL (
         SELECT phase.position
         FROM holistic_mentorship_phase_plans plan
         JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id
         JOIN grade phase_grade ON phase_grade.id = phase.grade_id AND phase_grade.number = grade.number
         JOIN LATERAL (
           SELECT transition.to_state
           FROM holistic_mentorship_phase_state_transitions transition
           WHERE transition.phase_id = phase.id AND transition.occurred_at <= mapped.started_at
           ORDER BY transition.occurred_at DESC, transition.id DESC LIMIT 1
         ) phase_state ON phase_state.to_state = 'open'
         WHERE plan.program_id = $1 AND plan.academic_year = $2
         ORDER BY phase.position DESC LIMIT 1
       ) initial_active ON true
       WHERE ($4::text IS NULL OR school.code = $4)
         AND ($3::bigint IS NULL OR selected_phase.id IS NOT NULL)
         AND ($5::int IS NULL OR grade.number = $5)
         AND ($6::bigint IS NULL OR mapped.mentor_user_id = $6)
         AND ($8 = '%%' OR st.student_id ILIKE $8 OR
              TRIM(COALESCE(student_user.first_name, '') || ' ' || COALESCE(student_user.last_name, '')) ILIKE $8)
     ), derived AS (
       SELECT base.*,
              CASE WHEN base.phase_id IS NULL THEN 'no_active_phase'
                   WHEN notes.state = 'submitted' THEN 'completed'
                   WHEN base.initial_active_position IS NOT NULL AND base.phase_number < base.initial_active_position THEN 'skipped'
                   ELSE 'pending' END AS progress,
              CASE WHEN notes.state = 'submitted' THEN notes.first_submitted_at END AS completed_at,
              CASE WHEN notes.state = 'submitted' THEN notes.last_edited_at END AS notes_last_edited_at,
              NULLIF(TRIM(COALESCE(author.first_name, '') || ' ' || COALESCE(author.last_name, '')), '') AS notes_author,
              COALESCE(note_answers.answers, '[]'::jsonb) AS answers
       FROM base
       LEFT JOIN holistic_mentorship_post_session_notes notes
         ON notes.student_id = base.student_id AND notes.phase_id = base.phase_id
       LEFT JOIN "user" author ON author.id = notes.author_user_id AND notes.state = 'submitted'
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('position', question.position, 'question', question.text, 'answer', answer.answer)
                          ORDER BY question.position) AS answers
         FROM holistic_mentorship_post_session_answers answer
         JOIN holistic_mentorship_phase_questions question ON question.id = answer.question_id
         WHERE answer.notes_id = notes.id AND notes.state = 'submitted'
       ) note_answers ON true
     ), filtered AS (
       SELECT * FROM derived WHERE ($7::text IS NULL OR progress = $7)
     ), counts AS (
       SELECT COUNT(*) AS total_mapped,
              COUNT(*) FILTER (WHERE progress = 'pending') AS pending_count,
              COUNT(*) FILTER (WHERE progress = 'completed') AS completed_count,
              COUNT(*) FILTER (WHERE progress = 'skipped') AS skipped_count,
              COUNT(*) FILTER (WHERE progress = 'no_active_phase') AS no_active_phase_count
       FROM filtered
     ), paged AS (
       SELECT * FROM filtered ORDER BY ${order} LIMIT $9 OFFSET $10
     )
     SELECT paged.*, counts.* FROM counts LEFT JOIN paged ON true ORDER BY ${order}`,
    [
      PROGRAM_IDS.COE,
      filters.academicYear,
      filters.phaseId,
      filters.schoolCode,
      filters.grade,
      filters.mentorUserId,
      filters.progress,
      `%${filters.search}%`,
      limit,
      offset,
      CURRENT_ACADEMIC_YEAR,
    ]
  );
  const first = rows[0];
  return {
    rows: rows.filter((row) => row.student_id !== null).map((row) => ({
      studentId: Number(row.student_id),
      studentName: row.student_name || row.external_student_id || "Unknown Student",
      externalStudentId: row.external_student_id,
      grade: Number(row.grade) as 11 | 12,
      schoolName: row.school_name,
      schoolCode: row.school_code,
      mentorName: row.mentor_name || row.mentor_email || "Unknown Mentor",
      mentorEmail: row.mentor_email,
      phaseId: row.phase_id === null ? null : Number(row.phase_id),
      phaseNumber: row.phase_number === null ? null : Number(row.phase_number),
      phaseTitle: row.phase_title,
      phaseState: row.phase_state,
      progress: row.progress,
      completedAt: row.completed_at,
      notesAuthor: row.notes_author,
      notesLastEditedAt: row.notes_last_edited_at,
      answers: parsedAnswers(row.answers),
    })),
    counts: {
      totalMapped: Number(first?.total_mapped ?? 0),
      pending: Number(first?.pending_count ?? 0),
      completed: Number(first?.completed_count ?? 0),
      skipped: Number(first?.skipped_count ?? 0),
      noActivePhase: Number(first?.no_active_phase_count ?? 0),
    },
  };
}

export async function getHolisticProgressOptions(academicYear: string): Promise<HolisticProgressOptions> {
  const mappingFilter = `mapping.program_id = $1 AND mapping.academic_year = $2
       AND ($2 <> $3 OR mapping.ended_at IS NULL)`;
  const [schools, mentors, phases] = await Promise.all([
    query<{ code: string; name: string }>(
      `SELECT DISTINCT school.code, school.name
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       JOIN school ON school.id = mapping.school_id
       WHERE ${mappingFilter} ORDER BY school.name, school.code`,
      [PROGRAM_IDS.COE, academicYear, CURRENT_ACADEMIC_YEAR]
    ),
    query<{ user_id: number | string; name: string | null; email: string }>(
      `SELECT DISTINCT mentor.id AS user_id,
              NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), '') AS name,
              mentor.email
       FROM holistic_mentorship_mentor_mentee_mappings mapping
       JOIN "user" mentor ON mentor.id = mapping.mentor_user_id
       WHERE ${mappingFilter}
       ORDER BY name NULLS LAST, mentor.email`,
      [PROGRAM_IDS.COE, academicYear, CURRENT_ACADEMIC_YEAR]
    ),
    query<{ id: number | string; position: number; title: string; grade: number | string; state: "open" | "locked" }>(
      `SELECT phase.id, phase.position, phase.title, grade.number AS grade, phase.state
       FROM holistic_mentorship_phase_plans plan
       JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id
       JOIN grade ON grade.id = phase.grade_id
       WHERE plan.program_id = $1 AND plan.academic_year = $2
       ORDER BY phase.position, phase.id`,
      [PROGRAM_IDS.COE, academicYear]
    ),
  ]);
  return {
    schools,
    mentors: mentors.map((mentor) => ({ userId: Number(mentor.user_id), name: mentor.name || mentor.email })),
    phases: phases.map((phase) => ({
      id: Number(phase.id), number: phase.position, title: phase.title,
      grade: Number(phase.grade) as 11 | 12, state: phase.state,
    })),
  };
}

function csvCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) || safe !== raw
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

export function formatHolisticProgressCsv(academicYear: string, rows: HolisticProgressRow[]): string {
  const header = [
    "Academic Year", "Program", "School", "UDISE Code", "Student Name", "Student External ID",
    "Grade", "Mentor Name", "Mentor Email", "Phase", "Phase Title", "Availability", "Progress",
    "Completed At", "Question 1", "Answer 1", "Question 2", "Answer 2", "Question 3", "Answer 3",
    "Question 4", "Answer 4", "Notes Author", "Notes Last Edited At",
  ];
  const body = rows.map((row) => {
    const answers = Array.from({ length: 4 }, (_, index) => row.answers.find(({ position }) => position === index + 1));
    return [
      academicYear, "JNV CoE", row.schoolName, row.schoolCode, row.studentName, row.externalStudentId,
      row.grade, row.mentorName, row.mentorEmail, row.phaseNumber === null ? "" : `Phase ${row.phaseNumber}`,
      row.phaseTitle, row.phaseState, row.progress, row.completedAt,
      ...answers.flatMap((answer) => [answer?.question ?? "", answer?.answer ?? ""]),
      row.notesAuthor, row.notesLastEditedAt,
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...body].join("\r\n");
}
