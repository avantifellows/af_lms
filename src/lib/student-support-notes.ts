// Mentor notes in the cumulative report (Teacher View v2): the Holistic
// Mentorship post-session notes, shown only to people who can already read
// that student's notes in Holistic Mentorship. A teacher sees their own
// mentees; PM / program admin / admin see the program. Confidential: these
// reads are never exposed through the MCP views.
import {
  CURRENT_ACADEMIC_YEAR,
  isHolisticHistoricalImportProgramId,
  isHolisticMentorshipProgramId,
  programIdForLabel,
} from "./constants";
import { query } from "./db";
import { requireHolisticMentorshipAccess, type HolisticMentorshipSession } from "./holistic-mentorship";
import { getResolvedPermission } from "./permissions";
import type { MentorInteraction } from "@/types/student-support";

/** Who may read notes at this School, decided once for the grade's counts. */
type NotesReader =
  | { kind: "mentor"; programId: number; schoolId: number; actorUserId: number }
  | { kind: "program"; programId: number; schoolId: number };

/**
 * The Holistic gate for the School in the program being viewed (the report's
 * `program` label, e.g. "JNV CoE"). A School can have active centres in two
 * Holistic programs, so the gate is always asked for this one. A teacher reads
 * only their mapped mentees ("roster_view" proves they mentor here; the counts
 * query then keeps their active mappings). Everyone else needs
 * "mapped_student_read", the action the Holistic student read uses. Null = no
 * notes for this viewer, or a program that isn't a Holistic Mentorship one.
 */
async function notesReader(
  session: HolisticMentorshipSession,
  schoolCode: string,
  program: string
): Promise<NotesReader | null> {
  const programId = programIdForLabel(program);
  if (!isHolisticMentorshipProgramId(programId)) return null;
  const email = session?.user?.email;
  if (!email) return null;
  const permission = await getResolvedPermission(email);
  // A teacher asking "mapped_student_read" without a student would reconcile
  // the whole School's mappings and still be refused, so ask what they can do.
  const teacher = permission?.role === "teacher";
  const access = await requireHolisticMentorshipAccess(session, teacher ? "roster_view" : "mapped_student_read", {
    schoolCode,
    programId,
  });
  if (!access.ok || !access.school || access.programId === undefined) return null;
  if (teacher) {
    return access.actorUserId === undefined
      ? null
      : { kind: "mentor", programId: access.programId, schoolId: access.school.id, actorUserId: access.actorUserId };
  }
  return { kind: "program", programId: access.programId, schoolId: access.school.id };
}

// Notes a student can be shown: submitted post-session notes on this program's
// phases, plus the approved historical import where the program has one. A
// privacy deletion hides everything, as for Follow-up Notes.
const NOT_DELETED = `NOT EXISTS (
  SELECT 1 FROM holistic_mentorship_privacy_deletions deletion WHERE deletion.student_id = student.id
)`;
const HISTORICAL_SOURCES = "('approved_2025_holistic_export', 'synthetic_fixture')";

/**
 * Note counts per student (keyed by user id, the report's uid) for one grade
 * of the School. Students the viewer may not read are absent, so the page
 * shows "—" for them, the same as for no notes.
 */
export async function getMentorNoteCounts(
  session: HolisticMentorshipSession,
  schoolCode: string,
  program: string,
  grade: number
): Promise<Record<string, number>> {
  const reader = await notesReader(session, schoolCode, program);
  if (!reader) return {};
  const historical = isHolisticHistoricalImportProgramId(reader.programId);
  const rows = await query<{ uid: string; notes: number | string }>(
    `SELECT student.user_id::text AS uid,
            (SELECT COUNT(*) FROM holistic_mentorship_post_session_notes notes
               JOIN holistic_mentorship_phases phase ON phase.id = notes.phase_id
               JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
              WHERE notes.student_id = student.id AND notes.state = 'submitted' AND plan.program_id = $2)
          + (SELECT COUNT(*) FROM holistic_mentorship_historical_notes historical
              WHERE $5::boolean AND historical.student_id = student.id
                AND historical.source_system IN ${HISTORICAL_SOURCES}
                AND EXISTS (SELECT 1 FROM holistic_mentorship_historical_note_answers answer
                             WHERE answer.historical_note_id = historical.id)) AS notes
     FROM student
     JOIN centre_students roster ON roster.user_id = student.user_id
     JOIN centres centre
       ON centre.id = roster.centre_id AND centre.school_id = $1
      AND centre.program_id = $2 AND centre.is_active IS TRUE
     WHERE roster.academic_year = $3 AND roster.program_id = $2 AND roster.grade = $4
       AND student.status IS DISTINCT FROM 'dropout'
       AND ${NOT_DELETED}
       AND ($6::bigint IS NULL OR EXISTS (
         SELECT 1 FROM holistic_mentorship_mentor_mentee_mappings mapping
          WHERE mapping.student_id = student.id AND mapping.mentor_user_id = $6
            AND mapping.school_id = $1 AND mapping.program_id = $2
            AND mapping.academic_year = $3 AND mapping.ended_at IS NULL
       ))`,
    [
      reader.schoolId,
      reader.programId,
      CURRENT_ACADEMIC_YEAR,
      grade,
      historical,
      reader.kind === "mentor" ? reader.actorUserId : null,
    ]
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.uid] = Number(r.notes);
  return counts;
}

interface NoteRow {
  id: string;
  title: string | null;
  date: string | null;
  mentor: string | null;
  question: string | null;
  answer: string | null;
  position: number | null;
}

/**
 * One student's notes, newest first, each with its questions and answers as
 * written. Null when the viewer may not read this student's notes (the same
 * per-student check the Holistic student read makes).
 */
export async function getMentorNotes(
  session: HolisticMentorshipSession,
  schoolCode: string,
  program: string,
  uid: string
): Promise<MentorInteraction[] | null> {
  const [student] = await query<{ id: number | string }>(`SELECT id FROM student WHERE user_id = $1 LIMIT 1`, [
    Number(uid),
  ]);
  if (!student) return null;
  const studentId = Number(student.id);
  const reader = await notesReader(session, schoolCode, program);
  if (!reader) return null;
  const access = await requireHolisticMentorshipAccess(session, "mapped_student_read", {
    schoolCode,
    studentId,
    academicYear: CURRENT_ACADEMIC_YEAR,
    programId: reader.programId,
  });
  if (!access.ok) return null;

  const rows = await query<NoteRow>(
    `SELECT 'n' || notes.id AS id, phase.title,
            COALESCE(notes.first_submitted_at, notes.last_edited_at)::text AS date,
            NULLIF(TRIM(COALESCE(author.first_name, '') || ' ' || COALESCE(author.last_name, '')), '') AS mentor,
            question.text AS question, answer.answer, question.position
       FROM holistic_mentorship_post_session_notes notes
       JOIN student ON student.id = notes.student_id
       JOIN holistic_mentorship_phases phase ON phase.id = notes.phase_id
       JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
       LEFT JOIN "user" author ON author.id = notes.author_user_id
       LEFT JOIN holistic_mentorship_post_session_answers answer ON answer.notes_id = notes.id
       LEFT JOIN holistic_mentorship_phase_questions question ON question.id = answer.question_id
      WHERE notes.student_id = $1 AND notes.state = 'submitted' AND plan.program_id = $2
        AND ${NOT_DELETED}
     UNION ALL
     SELECT 'h' || historical.id, NULL, NULL,
            NULLIF(TRIM(COALESCE(mentor.first_name, '') || ' ' || COALESCE(mentor.last_name, '')), ''),
            answer.question, answer.answer, answer.position
       FROM holistic_mentorship_historical_notes historical
       JOIN student ON student.id = historical.student_id
       LEFT JOIN "user" mentor ON mentor.id = historical.mentor_user_id
       JOIN holistic_mentorship_historical_note_answers answer ON answer.historical_note_id = historical.id
      WHERE $3::boolean AND historical.student_id = $1
        AND historical.source_system IN ${HISTORICAL_SOURCES}
        AND ${NOT_DELETED}
      ORDER BY date DESC NULLS LAST, id, position`,
    [studentId, reader.programId, isHolisticHistoricalImportProgramId(reader.programId)]
  );
  return groupInteractions(rows);
}

/** Rows (one per answer) → interactions, keeping the query's newest-first order. */
export function groupInteractions(rows: NoteRow[]): MentorInteraction[] {
  const byId = new Map<string, MentorInteraction>();
  for (const r of rows) {
    const it = byId.get(r.id) ?? {
      title: r.title ?? "Earlier notes (imported)",
      date: r.date,
      mentor: r.mentor,
      answers: [],
    };
    if (r.question) it.answers.push({ question: r.question, answer: r.answer });
    byId.set(r.id, it);
  }
  return [...byId.values()];
}
