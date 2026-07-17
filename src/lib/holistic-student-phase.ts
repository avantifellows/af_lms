import { PROGRAM_IDS } from "./constants";
import { query } from "./db";

export type HolisticPhaseProgress = "pending" | "skipped" | "completed";

export type HolisticPhaseTimeline = {
  id: number;
  position: number;
  transitions: Array<{
    toState: "locked" | "open";
    occurredAt: string;
  }>;
};

export type HolisticPhaseNotesState = {
  phaseId: number;
  state: "draft" | "submitted";
};

type ApplicablePhase = {
  id: number;
  number: number;
  grade: 11 | 12;
  title: string;
};

export function buildHolisticApplicablePhases<T extends ApplicablePhase>(input: {
  currentGrade: 11 | 12;
  entryGrade: 11 | 12;
  hasPriorYearMapping: boolean;
  currentPhases: T[];
  priorGrade11Phases: T[];
}): Array<T | { phaseId: null; number: number; title: string; placeholder: true }> {
  if (input.currentGrade === 11) {
    return input.currentPhases.filter(({ grade }) => grade === 11);
  }
  const currentGrade12 = input.currentPhases.filter(({ grade }) => grade === 12);
  if (input.entryGrade === 11 && input.hasPriorYearMapping) {
    return [...input.priorGrade11Phases, ...currentGrade12];
  }
  return [
    ...[1, 2, 3, 4].map((number) => ({
      phaseId: null,
      number,
      title: `Phase ${number}`,
      placeholder: true as const,
    })),
    ...currentGrade12.map((phase, index) => ({
      ...phase,
      number: Math.max(phase.number, index + 5),
    })),
  ];
}

export type HolisticStudentContext = {
  label: "Student Profile" | "Historical notes" | `From Phase ${number} - ${string}`;
  items: Array<{ label: string; content: string }>;
  lastUpdatedAt?: string;
} | {
  label: null;
  items: [];
  missing: "No previous session notes available";
};

export type HolisticPhaseSummary =
  | { phaseId: null; number: number; title: string; placeholder: true }
  | { phaseId: number; number: number; title: string; locked: true }
  | {
      phaseId: number;
      number: number;
      title: string;
      grade: 11 | 12;
      academicYear: string;
      locked: false;
      active: boolean;
      progress: HolisticPhaseProgress;
      draftSaved: boolean;
    };

export type HolisticStudentPhaseDetail = {
  student: { id: number; name: string; externalStudentId: string | null; grade: 11 | 12 };
  phases: HolisticPhaseSummary[];
  selectedPhase: HolisticPhaseSummary | (Extract<HolisticPhaseSummary, { locked: false }> & {
    revision: number;
    mappingId: number;
    notesRevision: number;
    canEditNotes: boolean;
    guidanceMarkdown: string;
    context: HolisticStudentContext;
    questions: Array<{ questionId: number; text: string; position: number }>;
    notes: null | {
      state: "draft" | "submitted";
      revision: number;
      firstSubmittedAt: string | null;
      lastEditedAt: string;
      answers?: Array<{ questionId: number; question: string; answer: string }>;
    };
  });
  readOnly: boolean;
};

export function resolveHolisticStudentContext(input: {
  targetPhaseId: number;
  phases: Array<{ id: number; number: number; title: string }>;
  submittedNotes: Array<{
    phaseId: number;
    lastEditedAt: string;
    answers: Array<{ question: string; answer: string }>;
  }>;
  profile: Array<{ title: string; summary: string }> | null;
  historicalAnswers: Array<{ question: string; answer: string | null }> | null;
  launchGrade12: boolean;
  entryGradeFirstPhaseId: number;
}): HolisticStudentContext {
  const targetIndex = input.phases.findIndex(({ id }) => id === input.targetPhaseId);
  const submittedByPhase = new Map(input.submittedNotes.map((notes) => [notes.phaseId, notes]));
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const sourcePhase = input.phases[index];
    const notes = submittedByPhase.get(sourcePhase.id);
    if (notes) {
      return {
        label: `From Phase ${sourcePhase.number} - ${sourcePhase.title}`,
        items: notes.answers.map(({ question, answer }) => ({ label: question, content: answer })),
        lastUpdatedAt: notes.lastEditedAt,
      };
    }
  }

  if (input.launchGrade12 && input.historicalAnswers?.some(({ answer }) => answer?.trim())) {
    return {
      label: "Historical notes",
      items: input.historicalAnswers.map(({ question, answer }) => ({
        label: question,
        content: answer?.trim() || "No response recorded",
      })),
    };
  }
  if (input.targetPhaseId === input.entryGradeFirstPhaseId && input.profile) {
    return {
      label: "Student Profile",
      items: input.profile.map(({ title, summary }) => ({ label: title, content: summary })),
    };
  }
  return {
    label: null,
    items: [],
    missing: "No previous session notes available",
  };
}

export function deriveHolisticPhaseProgress(
  phases: HolisticPhaseTimeline[],
  firstMappingAt: string | null,
  notes: HolisticPhaseNotesState[]
): Map<number, HolisticPhaseProgress> {
  const mappingTime = firstMappingAt ? Date.parse(firstMappingAt) : null;
  const activePosition = mappingTime === null
    ? null
    : phases.reduce<number | null>((latest, phase) => {
        const state = phase.transitions
          .filter(({ occurredAt }) => Date.parse(occurredAt) <= mappingTime)
          .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
          .at(-1)?.toState ?? "locked";
        return state === "open" && (latest === null || phase.position > latest)
          ? phase.position
          : latest;
      }, null);
  const notesByPhase = new Map(notes.map((item) => [item.phaseId, item.state]));

  return new Map(phases.map((phase) => [
    phase.id,
    notesByPhase.get(phase.id) === "submitted"
      ? "completed"
      : activePosition !== null && phase.position < activePosition && !notesByPhase.has(phase.id)
        ? "skipped"
        : "pending",
  ]));
}

type StudentRow = {
  student_id: number | string;
  mapping_id: number | string;
  name: string | null;
  external_student_id: string | null;
  grade: number | string;
  entry_grade: number | string | null;
};

type PhaseRow = {
  id: number | string;
  academic_year: string;
  grade: number | string;
  title: string;
  position: number;
  revision: number;
  state: "locked" | "open";
  guidance_markdown: string;
};

type QuestionRow = {
  id: number | string;
  phase_id: number | string;
  text: string;
  position: number;
};

type TransitionRow = {
  phase_id: number | string;
  to_state: "locked" | "open";
  occurred_at: string;
};

type NotesRow = {
  notes_id: number | string;
  phase_id: number | string;
  author_user_id: number | string;
  state: "draft" | "submitted";
  revision: number;
  first_submitted_at: string | null;
  last_edited_at: string;
  question_id: number | string | null;
  question: string | null;
  question_position: number | null;
  answer: string | null;
};

type ProfileRow = { title: string; summary: string; position: number };
type HistoricalRow = { question: string; answer: string | null; position: number };

type StudentPhaseParams = {
  studentId: number;
  phaseId: number;
  schoolId: number;
  academicYear: string;
  actorUserId?: number;
  role: string;
  canEdit: boolean;
};

type PhaseNotes = {
  notesId: number;
  authorUserId: number;
  state: "draft" | "submitted";
  revision: number;
  firstSubmittedAt: string | null;
  lastEditedAt: string;
  answers: Array<{ questionId: number; question: string; answer: string }>;
};

type NumberedPhase = Omit<PhaseRow, "id" | "grade"> & ApplicablePhase;

type PhaseRelations = {
  questionRows: QuestionRow[];
  transitionRows: TransitionRow[];
  mappingRows: Array<{ academic_year: string; started_at: string }>;
  notesRows: NotesRow[];
  profileRows: ProfileRow[];
  historicalRows: HistoricalRow[];
};

type OpenSelectedPhaseParams = {
  selected: NumberedPhase;
  applicable: NumberedPhase[];
  notesByPhase: Map<number, PhaseNotes>;
  questionsByPhase: Map<number, Array<{ questionId: number; text: string; position: number }>>;
  progress: Map<number, HolisticPhaseProgress>;
  active: Map<string, number>;
  profileRows: ProfileRow[];
  historicalRows: HistoricalRow[];
  currentGrade: 11 | 12;
  entryGrade: 11 | 12;
  hasPriorYearMapping: boolean;
  actorUserId?: number;
  role: string;
  canEdit: boolean;
  mappingId: number;
};

function previousAcademicYear(academicYear: string): string {
  const start = Number(academicYear.slice(0, 4));
  return `${start - 1}-${start}`;
}

async function loadMappedStudent(params: StudentPhaseParams): Promise<StudentRow | null> {
  const students = await query<StudentRow>(
    `SELECT st.id AS student_id, mapping.id AS mapping_id,
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') AS name,
            st.student_id AS external_student_id, g.number AS grade, journey.entry_grade
     FROM holistic_mentorship_mentor_mentee_mappings mapping
     JOIN student st ON st.id = mapping.student_id AND st.status IS DISTINCT FROM 'dropout'
     JOIN "user" u ON u.id = st.user_id
     JOIN group_user membership ON membership.user_id = u.id
     JOIN "group" school_group ON school_group.id = membership.group_id
       AND school_group.type = 'school' AND school_group.child_id = mapping.school_id
     JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = u.id
       AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = mapping.academic_year
       AND grade_enrollment.is_current IS TRUE
     JOIN grade g ON g.id = grade_enrollment.group_id AND g.number IN (11, 12)
     JOIN LATERAL (
       SELECT b.program_id FROM enrollment_record batch_enrollment
       JOIN "group" batch_group ON batch_group.id = batch_enrollment.group_id AND batch_group.type = 'batch'
       JOIN batch b ON b.id = batch_group.child_id
       WHERE batch_enrollment.user_id = u.id AND batch_enrollment.group_type = 'batch'
         AND batch_enrollment.is_current IS TRUE
       ORDER BY array_position(ARRAY[1, 2, 64]::int[], b.program_id), batch_enrollment.id LIMIT 1
     ) roster_program ON roster_program.program_id = mapping.program_id
     LEFT JOIN holistic_mentorship_profile_journeys journey ON journey.student_id = st.id
     WHERE mapping.student_id = $1 AND mapping.school_id = $2 AND mapping.program_id = $3
       AND mapping.academic_year = $4 AND mapping.ended_at IS NULL
     LIMIT 1`,
    [params.studentId, params.schoolId, PROGRAM_IDS.COE, params.academicYear]
  );
  return students[0] ?? null;
}

async function loadPhaseRows(academicYears: string[]): Promise<PhaseRow[]> {
  return query<PhaseRow>(
    `SELECT phase.id, plan.academic_year, grade.number AS grade, phase.title,
            phase.position, phase.state, phase.guidance_markdown, phase.revision
     FROM holistic_mentorship_phases phase
     JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
     JOIN grade ON grade.id = phase.grade_id
     WHERE plan.program_id = $1 AND plan.academic_year = ANY($2::text[])
     ORDER BY plan.academic_year, phase.position`,
    [PROGRAM_IDS.COE, academicYears]
  );
}

async function loadPhaseRelations(
  params: StudentPhaseParams,
  phaseIds: number[],
  academicYears: string[]
): Promise<PhaseRelations> {
  const [questionRows, transitionRows, mappingRows, notesRows, profileRows, historicalRows] = await Promise.all([
    query<QuestionRow>(
      `SELECT id, phase_id, text, position FROM holistic_mentorship_phase_questions
       WHERE phase_id = ANY($1::bigint[]) ORDER BY phase_id, position`,
      [phaseIds]
    ),
    query<TransitionRow>(
      `SELECT phase_id, to_state, occurred_at FROM holistic_mentorship_phase_state_transitions
       WHERE phase_id = ANY($1::bigint[]) ORDER BY phase_id, occurred_at, id`,
      [phaseIds]
    ),
    query<{ academic_year: string; started_at: string }>(
      `SELECT academic_year, MIN(started_at) AS started_at
       FROM holistic_mentorship_mentor_mentee_mappings
       WHERE student_id = $1 AND program_id = $2 AND academic_year = ANY($3::text[])
       GROUP BY academic_year`,
      [params.studentId, PROGRAM_IDS.COE, academicYears]
    ),
    query<NotesRow>(
      `SELECT notes.id AS notes_id, notes.phase_id, notes.author_user_id, notes.state,
              notes.revision, notes.first_submitted_at, notes.last_edited_at,
              question.id AS question_id, question.text AS question,
              question.position AS question_position, answer.answer
       FROM holistic_mentorship_post_session_notes notes
       LEFT JOIN holistic_mentorship_post_session_answers answer ON answer.notes_id = notes.id
       LEFT JOIN holistic_mentorship_phase_questions question ON question.id = answer.question_id
       WHERE notes.student_id = $1 AND notes.phase_id = ANY($2::bigint[])
       ORDER BY notes.phase_id, question.position`,
      [params.studentId, phaseIds]
    ),
    query<ProfileRow>(
      `SELECT summary.question_set_title AS title, summary.summary, summary.position
       FROM holistic_mentorship_profile_journeys journey
       JOIN holistic_mentorship_student_profiles profile ON profile.profile_journey_id = journey.id
       JOIN holistic_mentorship_prompt_configurations configuration
         ON configuration.id = profile.prompt_configuration_id AND configuration.state = 'active'
       JOIN holistic_mentorship_student_profile_summaries summary ON summary.student_profile_id = profile.id
       WHERE journey.student_id = $1 ORDER BY summary.position`,
      [params.studentId]
    ),
    query<HistoricalRow>(
      `SELECT answer.question, answer.answer, answer.position
       FROM holistic_mentorship_historical_notes notes
       JOIN holistic_mentorship_historical_note_answers answer ON answer.historical_note_id = notes.id
       WHERE notes.student_id = $1 ORDER BY answer.position`,
      [params.studentId]
    ),
  ]);
  return { questionRows, transitionRows, mappingRows, notesRows, profileRows, historicalRows };
}

function groupTransitions(rows: TransitionRow[]) {
  const grouped = new Map<number, HolisticPhaseTimeline["transitions"]>();
  for (const row of rows) {
    const phaseId = Number(row.phase_id);
    const transitions = grouped.get(phaseId) ?? [];
    transitions.push({ toState: row.to_state, occurredAt: row.occurred_at });
    grouped.set(phaseId, transitions);
  }
  return grouped;
}

function groupQuestions(rows: QuestionRow[]) {
  const grouped = new Map<number, Array<{ questionId: number; text: string; position: number }>>();
  for (const row of rows) {
    const phaseId = Number(row.phase_id);
    const questions = grouped.get(phaseId) ?? [];
    questions.push({ questionId: Number(row.id), text: row.text, position: row.position });
    grouped.set(phaseId, questions);
  }
  return grouped;
}

function groupNotes(rows: NotesRow[]): Map<number, PhaseNotes> {
  const grouped = new Map<number, PhaseNotes>();
  for (const row of rows) {
    const phaseId = Number(row.phase_id);
    const notes = grouped.get(phaseId) ?? {
      notesId: Number(row.notes_id),
      authorUserId: Number(row.author_user_id),
      state: row.state,
      revision: row.revision,
      firstSubmittedAt: row.first_submitted_at,
      lastEditedAt: row.last_edited_at,
      answers: [],
    };
    if (row.question !== null && row.answer !== null) {
      notes.answers.push({
        questionId: Number(row.question_id),
        question: row.question,
        answer: row.answer,
      });
    }
    grouped.set(phaseId, notes);
  }
  return grouped;
}

function numberPhases(rows: PhaseRow[]): NumberedPhase[] {
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    grade: Number(row.grade) as 11 | 12,
    number: rows.filter((candidate) =>
      candidate.academic_year === row.academic_year && candidate.position <= row.position
    ).length,
  }));
}

function progressByPhase(params: {
  phases: NumberedPhase[];
  academicYears: string[];
  firstMappingByYear: Map<string, string>;
  transitionsByPhase: Map<number, HolisticPhaseTimeline["transitions"]>;
  notesByPhase: Map<number, PhaseNotes>;
}) {
  const result = new Map<number, HolisticPhaseProgress>();
  for (const year of params.academicYears) {
    for (const grade of [11, 12] as const) {
      const phases = params.phases.filter((phase) => phase.academic_year === year && phase.grade === grade);
      const progress = deriveHolisticPhaseProgress(
        phases.map((phase) => ({
          id: phase.id,
          position: phase.position,
          transitions: params.transitionsByPhase.get(phase.id) ?? [],
        })),
        params.firstMappingByYear.get(year) ?? null,
        phases.flatMap((phase) => {
          const notes = params.notesByPhase.get(phase.id);
          return notes ? [{ phaseId: phase.id, state: notes.state }] : [];
        })
      );
      for (const item of progress) result.set(...item);
    }
  }
  return result;
}

function activePhases(phases: NumberedPhase[]) {
  const active = new Map<string, number>();
  for (const phase of phases) {
    if (phase.state === "open") active.set(`${phase.academic_year}:${phase.grade}`, phase.id);
  }
  return active;
}

function studentSummary(student: StudentRow, grade: 11 | 12) {
  return {
    id: Number(student.student_id),
    name: student.name || student.external_student_id || "Unknown Student",
    externalStudentId: student.external_student_id,
    grade,
  };
}

function summarizePhase(
  phase: NumberedPhase | { phaseId: null; number: number; title: string; placeholder: true },
  notesByPhase: Map<number, PhaseNotes>,
  progress: Map<number, HolisticPhaseProgress>,
  active: Map<string, number>
): HolisticPhaseSummary {
  if (!("id" in phase)) return phase;
  if (phase.state === "locked") {
    return { phaseId: phase.id, number: phase.number, title: phase.title, locked: true };
  }
  const notes = notesByPhase.get(phase.id);
  return {
    phaseId: phase.id,
    number: phase.number,
    title: phase.title,
    grade: phase.grade,
    academicYear: phase.academic_year,
    locked: false,
    active: active.get(`${phase.academic_year}:${phase.grade}`) === phase.id,
    progress: progress.get(phase.id) ?? "pending",
    draftSaved: notes?.state === "draft",
  };
}

function submittedPhaseNotes(
  phases: NumberedPhase[],
  notesByPhase: Map<number, PhaseNotes>
) {
  return phases.flatMap((phase) => {
    const notes = notesByPhase.get(phase.id);
    return notes?.state === "submitted"
      ? [{ phaseId: phase.id, lastEditedAt: notes.lastEditedAt, answers: notes.answers }]
      : [];
  });
}

function selectedPhaseContext(params: OpenSelectedPhaseParams) {
  return resolveHolisticStudentContext({
    targetPhaseId: params.selected.id,
    phases: params.applicable.map(({ id, number, title }) => ({ id, number, title })),
    submittedNotes: submittedPhaseNotes(params.applicable, params.notesByPhase),
    profile: params.profileRows.length
      ? params.profileRows.map(({ title, summary }) => ({ title, summary }))
      : null,
    historicalAnswers: params.historicalRows.length
      ? params.historicalRows.map(({ question, answer }) => ({ question, answer }))
      : null,
    launchGrade12: params.currentGrade === 12 && !params.hasPriorYearMapping,
    entryGradeFirstPhaseId: params.applicable.find(({ grade }) => grade === params.entryGrade)?.id ??
      params.selected.id,
  });
}

function erasedDraftForActor(
  notes: PhaseNotes | undefined,
  actorUserId: number | undefined,
  teacher: boolean
) {
  if (!teacher || notes?.state !== "draft") return false;
  return notes.authorUserId !== actorUserId && notes.answers.length === 0;
}

function visibleNotes(notes: PhaseNotes | undefined, canReadDraft: boolean, erasedDraft: boolean) {
  if (!notes || erasedDraft) return null;
  const detail = {
    state: notes.state,
    revision: notes.revision,
    firstSubmittedAt: notes.firstSubmittedAt,
    lastEditedAt: notes.lastEditedAt,
  };
  return notes.state === "submitted" || canReadDraft
    ? { ...detail, answers: notes.answers }
    : detail;
}

function canEditSelectedNotes(
  notes: PhaseNotes | undefined,
  params: OpenSelectedPhaseParams,
  teacher: boolean,
  erasedDraft: boolean
) {
  if (!teacher) return false;
  if (!params.canEdit) return false;
  if (!notes) return true;
  if (notes.authorUserId === params.actorUserId) return true;
  return erasedDraft;
}

function openSelectedPhase(params: OpenSelectedPhaseParams) {
  const notes = params.notesByPhase.get(params.selected.id);
  const teacher = params.role === "teacher";
  const canReadDraft = teacher ? notes?.authorUserId === params.actorUserId : false;
  const erasedDraft = erasedDraftForActor(notes, params.actorUserId, teacher);
  return {
    phaseId: params.selected.id,
    number: params.selected.number,
    title: params.selected.title,
    grade: params.selected.grade,
    academicYear: params.selected.academic_year,
    locked: false as const,
    active: params.active.get(`${params.selected.academic_year}:${params.selected.grade}`) ===
      params.selected.id,
    progress: params.progress.get(params.selected.id) ?? "pending",
    draftSaved: notes?.state === "draft" && !erasedDraft,
    revision: params.selected.revision,
    mappingId: params.mappingId,
    notesRevision: notes?.revision ?? 0,
    canEditNotes: canEditSelectedNotes(notes, params, teacher, erasedDraft),
    guidanceMarkdown: params.selected.guidance_markdown,
    context: selectedPhaseContext(params),
    questions: params.questionsByPhase.get(params.selected.id) ?? [],
    notes: visibleNotes(notes, canReadDraft, erasedDraft),
  };
}

export async function getHolisticStudentPhase(params: {
  studentId: number;
  phaseId: number;
  schoolId: number;
  academicYear: string;
  actorUserId?: number;
  role: string;
  canEdit: boolean;
}): Promise<HolisticStudentPhaseDetail | null> {
  const student = await loadMappedStudent(params);
  if (!student) return null;

  const priorYear = previousAcademicYear(params.academicYear);
  const academicYears = [priorYear, params.academicYear];
  const phaseRows = await loadPhaseRows(academicYears);
  if (!phaseRows.some(({ id }) => Number(id) === params.phaseId)) return null;

  const relations = await loadPhaseRelations(
    params,
    phaseRows.map(({ id }) => Number(id)),
    academicYears
  );
  const { mappingRows, profileRows, historicalRows } = relations;
  const firstMappingByYear = new Map(mappingRows.map((row) => [row.academic_year, row.started_at]));
  const transitionsByPhase = groupTransitions(relations.transitionRows);
  const questionsByPhase = groupQuestions(relations.questionRows);
  const notesByPhase = groupNotes(relations.notesRows);
  const numbered = numberPhases(phaseRows);
  const currentGrade = Number(student.grade) as 11 | 12;
  const hasPriorYearMapping = firstMappingByYear.has(priorYear);
  const entryGrade = Number(student.entry_grade ?? (hasPriorYearMapping ? 11 : currentGrade)) as 11 | 12;
  const applicable = buildHolisticApplicablePhases({
    currentGrade,
    entryGrade,
    hasPriorYearMapping,
    currentPhases: numbered.filter(({ academic_year }) => academic_year === params.academicYear),
    priorGrade11Phases: numbered.filter(({ academic_year, grade }) => academic_year === priorYear && grade === 11),
  });
  const realApplicable = applicable.filter((phase): phase is NumberedPhase => "id" in phase);
  const selected = realApplicable.find(({ id }) => id === params.phaseId);
  if (!selected) return null;

  const progress = progressByPhase({
    phases: realApplicable,
    academicYears,
    firstMappingByYear,
    transitionsByPhase,
    notesByPhase,
  });
  const active = activePhases(numbered);
  const phases = applicable.map((phase) => summarizePhase(phase, notesByPhase, progress, active));
  const selectedSummary = summarizePhase(selected, notesByPhase, progress, active);
  const readOnly = params.role !== "teacher" || !params.canEdit;
  if (selected.state === "locked") {
    return {
      student: studentSummary(student, currentGrade),
      phases,
      selectedPhase: selectedSummary,
      readOnly,
    };
  }

  return {
    student: studentSummary(student, currentGrade),
    phases,
    selectedPhase: openSelectedPhase({
      selected,
      applicable: realApplicable,
      notesByPhase,
      questionsByPhase,
      progress,
      active,
      profileRows,
      historicalRows,
      currentGrade,
      entryGrade,
      hasPriorYearMapping,
      actorUserId: params.actorUserId,
      role: params.role,
      canEdit: params.canEdit,
      mappingId: Number(student.mapping_id),
    }),
    readOnly,
  };
}
