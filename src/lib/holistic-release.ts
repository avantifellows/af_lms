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

export async function runHolisticReleasePreflight(params: {
  db: Query;
  academicYear: string;
  profileSource: HolisticProfileSourceEvidence;
}) {
  const [schools, roster, actors, identities, historical] = await Promise.all([
    params.db<{ school_id: number }>(
      `/* preflight_program_schools */
       SELECT DISTINCT school_id
       FROM centres
       WHERE program_id = $1 AND is_active IS TRUE AND school_id IS NOT NULL`,
      [PROGRAM_IDS.COE]
    ),
    params.db<{ student_id: number; user_id: string; grade: number; has_profile: boolean }>(
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
    params.db<{ actor_class: string; actor_count: number | string }>(
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
    params.db<{ source_user_id: string; student_id: number; eligible: boolean }>(
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
    params.db<{ safe_candidates: number | string; excluded_rows: number | string }>(
      `/* preflight_historical */
       WITH source_student(business_student_id) AS (SELECT unnest($1::text[])), matches AS (
         SELECT source_student.business_student_id,
                COUNT(student.id) AS match_count,
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

  const blockers: string[] = [];
  for (const grade of [11, 12] as const) {
    const form = params.profileSource.forms.find((candidate) => candidate.grade === grade);
    const approved = APPROVED_PROFILE_FORMS[grade];
    const ids = new Set(form?.questions.map(({ questionId }) => questionId));
    const positions = new Set(form?.questions.map(({ position }) => position));
    const sets = new Set(form?.questions.map(({ questionSetTitle }) => questionSetTitle));
    if (!form || form.formId !== approved.formId || form.sessionId !== approved.sessionId ||
        form.questions.length !== 34 || ids.size !== 34 || positions.size !== 34 || sets.size !== 5) {
      blockers.push(`Approved Grade ${grade} Profile Form structure is invalid`);
    }
  }

  const bySourceUser = new Map<string, typeof identities>();
  for (const identity of identities) {
    const matches = bySourceUser.get(identity.source_user_id) ?? [];
    matches.push(identity);
    bySourceUser.set(identity.source_user_id, matches);
  }
  const uniqueSourceUsers = [...new Set(params.profileSource.sourceUserIds)];
  const missing = uniqueSourceUsers.filter((id) => !bySourceUser.has(id)).length;
  const ambiguous = uniqueSourceUsers.filter((id) => (bySourceUser.get(id)?.length ?? 0) > 1).length;
  const wrongScope = uniqueSourceUsers.filter((id) => {
    const matches = bySourceUser.get(id) ?? [];
    return matches.length === 1 && !matches[0].eligible;
  }).length;
  if (missing) blockers.push(`${missing} BigQuery User ${missing === 1 ? "identity is" : "identities are"} missing from LMS`);
  if (ambiguous) blockers.push(`${ambiguous} BigQuery User ${ambiguous === 1 ? "identity is" : "identities are"} ambiguous in LMS`);
  if (wrongScope) blockers.push(`${wrongScope} BigQuery User ${wrongScope === 1 ? "is" : "are"} outside the Program 1 Grade 11/12 roster`);

  const actorCount = (actorClass: string) => Number(actors.find(({ actor_class }) => actor_class === actorClass)?.actor_count ?? 0);
  const incompleteProfiles = roster.filter(({ has_profile }) => !has_profile).length;
  const history = historical[0] ?? { safe_candidates: 0, excluded_rows: 0 };
  return {
    ok: blockers.length === 0,
    blockers,
    warnings: incompleteProfiles
      ? [`${incompleteProfiles} eligible Student${incompleteProfiles === 1 ? " has" : "s have"} no successful Active-configuration Profile`]
      : [],
    counts: {
      programSchools: schools.length,
      eligibleStudents: roster.length,
      grade11Students: roster.filter(({ grade }) => Number(grade) === 11).length,
      grade12Students: roster.filter(({ grade }) => Number(grade) === 12).length,
      eligibleTeachers: actorCount("teacher"),
      holisticAdmins: actorCount("holistic_admin"),
      globalAdmins: actorCount("global_admin"),
      incompleteProfiles,
      historicalCandidates: Number(history.safe_candidates),
      excludedHistoricalRows: Number(history.excluded_rows),
    },
  };
}

export { APPROVED_PROFILE_FORMS };
