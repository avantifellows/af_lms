import { PROGRAM_IDS } from "./constants";
import { PM_SEAT_ROLES } from "./staff-shared";

const APPROVED_PROFILE_FORMS = {
  11: {
    formId: "6a44a83d1184e717b920c499",
    sessionId: "EnableStudents_6a44a83d1184e717b920c499",
  },
  12: {
    formId: "6a4deca8e030ebe34669fb0f",
    sessionId: "EnableStudents_6a4deca8e030ebe34669fb0f",
  },
} as const;
const APPROVED_PROFILE_GRADES = [11, 12] as const;
const APPROVED_PROFILE_THEME_COUNTS = [3, 6, 7, 8, 10];
const BIGQUERY_PROJECT_PATTERN = /^[A-Za-z0-9_-]+$/;
const BIGQUERY_DATASET_PATTERN = /^[A-Za-z0-9_]+$/;

type Query = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) => Promise<T[]>;

export interface HolisticProfileSourceEvidence {
  forms: Array<{
    grade: 11 | 12;
    formId: string;
    sessionId: string;
    questions: Array<{ questionId: string; position: number; questionSetTitle: string }>;
  }>;
  sourceUserIds: string[];
  historicalBusinessStudentIds?: string[];
}

interface BigQueryProfileRow {
  user_id: string | number;
  test_id: string;
  session_id: string;
  question_id: string;
  question_position_index: string | number;
  question_set_title: string;
}

type ProfileForm = HolisticProfileSourceEvidence["forms"][number];
type ProfileQuestion = ProfileForm["questions"][number];
type PreflightRosterRow = {
  student_id: number;
  user_id: string;
  grade: number;
  has_profile: boolean;
};
type PreflightActorRow = { actor_class: string; actor_count: number | string };
type PreflightIdentityRow = { source_user_id: string; student_id: number; eligible: boolean };
type PreflightHistoryRow = { safe_candidates: number | string; excluded_rows: number | string };

interface PreflightEvidence {
  schools: Array<{ school_id: number }>;
  roster: PreflightRosterRow[];
  actors: PreflightActorRow[];
  identities: PreflightIdentityRow[];
  historical: PreflightHistoryRow[];
}

interface PreflightParams {
  db: Query;
  academicYear: string;
  profileSource: HolisticProfileSourceEvidence;
}

export function buildHolisticProfileSourceQuery(project: string, dataset: string) {
  if (!BIGQUERY_PROJECT_PATTERN.test(project) || !BIGQUERY_DATASET_PATTERN.test(dataset)) {
    throw new Error("Invalid BigQuery project or dataset");
  }
  return {
    query: `SELECT user_id, test_id, session_id, question_id, question_position_index, question_set_title
            FROM \`${project}.${dataset}.all_responses_form_level\`
            WHERE test_type = 'form'
              AND ((test_id = @grade11Form AND session_id = @grade11Session)
                OR (test_id = @grade12Form AND session_id = @grade12Session))
            ORDER BY user_id, test_id, question_position_index, question_id`,
    params: {
      grade11Form: APPROVED_PROFILE_FORMS[11].formId,
      grade11Session: APPROVED_PROFILE_FORMS[11].sessionId,
      grade12Form: APPROVED_PROFILE_FORMS[12].formId,
      grade12Session: APPROVED_PROFILE_FORMS[12].sessionId,
    },
  };
}

export function buildHolisticProfileSourceEvidence(
  rows: BigQueryProfileRow[],
  historicalBusinessStudentIds: string[] = []
): HolisticProfileSourceEvidence {
  const approvedRows = rows.filter((row) =>
    Object.values(APPROVED_PROFILE_FORMS).some(
      ({ formId, sessionId }) => row.test_id === formId && row.session_id === sessionId
    )
  );
  const forms = ([11, 12] as const).map((grade) => {
    const approved = APPROVED_PROFILE_FORMS[grade];
    const questions = new Map<string, HolisticProfileSourceEvidence["forms"][number]["questions"][number]>();
    for (const row of approvedRows.filter(({ test_id }) => test_id === approved.formId)) {
      questions.set(row.question_id, {
        questionId: row.question_id,
        position: Number(row.question_position_index),
        questionSetTitle: row.question_set_title,
      });
    }
    return {
      grade,
      formId: approved.formId,
      sessionId: approved.sessionId,
      questions: [...questions.values()].sort((a, b) => a.position - b.position || a.questionId.localeCompare(b.questionId)),
    };
  });
  return {
    sourceUserIds: [...new Set(approvedRows.map(({ user_id }) => String(user_id)))].sort(),
    historicalBusinessStudentIds,
    forms,
  };
}

export async function runHolisticReleasePreflight(params: PreflightParams) {
  const evidence = await loadPreflightEvidence(params);
  const blockers = [
    ...getProfileFormBlockers(params.profileSource.forms),
    ...getIdentityBlockers(params.profileSource.sourceUserIds, evidence.identities),
  ];
  const incompleteProfiles = evidence.roster.filter(({ has_profile }) => !has_profile).length;
  return {
    ok: blockers.length === 0,
    blockers,
    warnings: getProfileWarnings(incompleteProfiles),
    counts: getPreflightCounts(evidence, incompleteProfiles),
  };
}

async function loadPreflightEvidence(params: PreflightParams): Promise<PreflightEvidence> {
  const [schools, roster, actors, identities, historical] = await Promise.all([
    params.db<{ school_id: number }>(
      `/* preflight_program_schools */
       SELECT DISTINCT school_id
       FROM centres
       WHERE program_id = $1 AND is_active IS TRUE AND school_id IS NOT NULL`,
      [PROGRAM_IDS.COE]
    ),
    params.db<PreflightRosterRow>(
      `/* preflight_roster */
       SELECT DISTINCT student.id AS student_id, student.user_id::text AS user_id,
              centre_students.grade,
              EXISTS (
                SELECT 1
                FROM holistic_mentorship_profile_journeys journey
                JOIN holistic_mentorship_student_profiles profile ON profile.profile_journey_id = journey.id
                JOIN holistic_mentorship_prompt_configurations configuration
                  ON configuration.id = profile.prompt_configuration_id AND configuration.state = 'active'
                WHERE journey.student_id = student.id
              ) AS has_profile
       FROM centre_students
       JOIN student ON student.user_id = centre_students.user_id
       WHERE centre_students.program_id = $1
         AND centre_students.academic_year = $2
         AND centre_students.grade IN (11, 12)
         AND student.status IS DISTINCT FROM 'dropout'`,
      [PROGRAM_IDS.COE, params.academicYear]
    ),
    params.db<PreflightActorRow>(
      `/* preflight_actors */
       WITH eligible_teachers AS (
         SELECT DISTINCT teacher.user_id
         FROM teacher
         JOIN centre_positions seat ON seat.user_id = teacher.user_id AND seat.deleted_at IS NULL
           AND NOT (seat.role = ANY($2::text[]))
         JOIN centres centre ON centre.id = seat.centre_id
           AND centre.program_id = $1 AND centre.is_active IS TRUE
         JOIN user_permission permission ON permission.revoked_at IS NULL
           AND permission.role = 'teacher'
           AND (permission.user_id = teacher.user_id OR LOWER(permission.email) = LOWER((SELECT email FROM "user" WHERE id = teacher.user_id)))
         WHERE teacher.is_af_teacher IS TRUE AND teacher.exit_date IS NULL
       )
       SELECT 'teacher' AS actor_class, COUNT(*) AS actor_count FROM eligible_teachers
       UNION ALL
       SELECT 'holistic_admin', COUNT(*) FROM user_permission
        WHERE role = 'holistic_mentorship_admin' AND revoked_at IS NULL
       UNION ALL
       SELECT 'global_admin', COUNT(*) FROM user_permission
        WHERE role = 'admin' AND level = 3 AND revoked_at IS NULL`,
      [PROGRAM_IDS.COE, [...PM_SEAT_ROLES]]
    ),
    params.db<PreflightIdentityRow>(
      `/* preflight_identity */
       WITH source_user(source_user_id) AS (SELECT unnest($1::text[]))
       SELECT source_user.source_user_id, student.id AS student_id,
              EXISTS (
                SELECT 1 FROM centre_students
                WHERE centre_students.user_id = student.user_id
                  AND centre_students.program_id = $2
                  AND centre_students.academic_year = $3
                  AND centre_students.grade IN (11, 12)
              ) AND student.status IS DISTINCT FROM 'dropout' AS eligible
       FROM source_user
       JOIN student ON student.user_id::text = source_user.source_user_id`,
      [params.profileSource.sourceUserIds, PROGRAM_IDS.COE, params.academicYear]
    ),
    params.db<PreflightHistoryRow>(
      `/* preflight_historical */
       WITH source_student(business_student_id) AS (SELECT unnest($1::text[])), matches AS (
         SELECT source_student.business_student_id,
                COUNT(DISTINCT student.id) AS match_count,
                BOOL_OR(centre_students.grade = 12 AND centre_students.program_id = $2
                  AND centre_students.academic_year = $3
                  AND student.status IS DISTINCT FROM 'dropout') AS eligible
         FROM source_student
         LEFT JOIN student ON student.student_id = source_student.business_student_id
         LEFT JOIN centre_students ON centre_students.user_id = student.user_id
         GROUP BY source_student.business_student_id
       )
       SELECT COUNT(*) FILTER (WHERE match_count = 1 AND eligible) AS safe_candidates,
              COUNT(*) FILTER (WHERE match_count <> 1 OR NOT COALESCE(eligible, FALSE)) AS excluded_rows
       FROM matches`,
      [params.profileSource.historicalBusinessStudentIds ?? [], PROGRAM_IDS.COE, params.academicYear]
    ),
  ]);
  return { schools, roster, actors, identities, historical };
}

function getProfileFormBlockers(forms: ProfileForm[]): string[] {
  return APPROVED_PROFILE_GRADES.flatMap((grade) => {
    const form = forms.find((candidate) => candidate.grade === grade);
    return isApprovedProfileForm(form, grade)
      ? []
      : [`Approved Grade ${grade} Profile Form structure is invalid`];
  });
}

function isApprovedProfileForm(form: ProfileForm | undefined, grade: 11 | 12): boolean {
  if (!form) return false;
  const approved = APPROVED_PROFILE_FORMS[grade];
  return form.formId === approved.formId &&
    form.sessionId === approved.sessionId &&
    hasApprovedQuestions(form.questions);
}

function hasApprovedQuestions(questions: ProfileQuestion[]): boolean {
  return questions.length === 34 &&
    new Set(questions.map(({ questionId }) => questionId)).size === 34 &&
    hasSequentialPositions(questions) &&
    hasApprovedThemeCounts(questions);
}

function hasSequentialPositions(questions: ProfileQuestion[]): boolean {
  const positions = questions.map(({ position }) => position).sort((a, b) => a - b);
  return positions.every((position, index) => position === index + 1);
}

function hasApprovedThemeCounts(questions: ProfileQuestion[]): boolean {
  const themes = new Map<string, number>();
  for (const { questionSetTitle } of questions) {
    themes.set(questionSetTitle, (themes.get(questionSetTitle) ?? 0) + 1);
  }
  const counts = [...themes.values()].sort((a, b) => a - b);
  return APPROVED_PROFILE_THEME_COUNTS.every((count, index) => counts[index] === count);
}

function groupIdentities(identities: PreflightIdentityRow[]): Map<string, PreflightIdentityRow[]> {
  const bySourceUser = new Map<string, PreflightIdentityRow[]>();
  for (const identity of identities) {
    const matches = bySourceUser.get(identity.source_user_id) ?? [];
    matches.push(identity);
    bySourceUser.set(identity.source_user_id, matches);
  }
  return bySourceUser;
}

function getIdentityIssueCounts(sourceUserIds: string[], identities: PreflightIdentityRow[]) {
  const bySourceUser = groupIdentities(identities);
  let missing = 0;
  let ambiguous = 0;
  let wrongScope = 0;
  for (const id of new Set(sourceUserIds)) {
    const matches = bySourceUser.get(id);
    if (!matches) missing += 1;
    else if (matches.length > 1) ambiguous += 1;
    else if (!matches[0].eligible) wrongScope += 1;
  }
  return { missing, ambiguous, wrongScope };
}

function getIdentityBlockers(
  sourceUserIds: string[],
  identities: PreflightIdentityRow[]
): string[] {
  const blockers: string[] = [];
  const { missing, ambiguous, wrongScope } = getIdentityIssueCounts(sourceUserIds, identities);
  addCountBlocker(blockers, missing, "identity is", "identities are", "missing from LMS");
  addCountBlocker(blockers, ambiguous, "identity is", "identities are", "ambiguous in LMS");
  addCountBlocker(
    blockers,
    wrongScope,
    "is",
    "are",
    "outside the Program 1 Grade 11/12 roster"
  );
  return blockers;
}

function addCountBlocker(
  blockers: string[],
  count: number,
  singular: string,
  plural: string,
  suffix: string
): void {
  if (!count) return;
  blockers.push(`${count} BigQuery User ${count === 1 ? singular : plural} ${suffix}`);
}

function getProfileWarnings(incompleteProfiles: number): string[] {
  if (!incompleteProfiles) return [];
  const verb = incompleteProfiles === 1 ? " has" : "s have";
  return [
    `${incompleteProfiles} eligible Student${verb} no successful Active-configuration Profile`,
  ];
}

function getPreflightCounts(evidence: PreflightEvidence, incompleteProfiles: number) {
  const history = evidence.historical[0] ?? { safe_candidates: 0, excluded_rows: 0 };
  return {
    programSchools: evidence.schools.length,
    eligibleStudents: evidence.roster.length,
    grade11Students: countRosterGrade(evidence.roster, 11),
    grade12Students: countRosterGrade(evidence.roster, 12),
    eligibleTeachers: getActorCount(evidence.actors, "teacher"),
    holisticAdmins: getActorCount(evidence.actors, "holistic_admin"),
    globalAdmins: getActorCount(evidence.actors, "global_admin"),
    incompleteProfiles,
    historicalCandidates: Number(history.safe_candidates),
    excludedHistoricalRows: Number(history.excluded_rows),
  };
}

function countRosterGrade(roster: PreflightRosterRow[], grade: number): number {
  return roster.filter((row) => Number(row.grade) === grade).length;
}

function getActorCount(actors: PreflightActorRow[], actorClass: string): number {
  const actor = actors.find(({ actor_class }) => actor_class === actorClass);
  return Number(actor?.actor_count ?? 0);
}
