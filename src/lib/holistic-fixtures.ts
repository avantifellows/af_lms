import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { PROGRAM_IDS } from "./constants";

export const HOLISTIC_FIXTURE_MANIFEST = {
  academicYear: "2026-2027",
  grades: [11, 12],
  actorClasses: [
    "teacher",
    "former_mentor",
    "holistic_mentorship_admin",
    "admin",
    "program_manager",
    "program_admin",
    "read_only",
    "passcode",
  ],
  states: ["locked", "open", "active", "skipped", "pending", "completed"],
  content: ["mapping", "profile", "historical_notes", "draft_notes", "submitted_notes"],
  syntheticOnly: true,
} as const;

type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" }
) => void;

export function applyHolisticDbServiceSchema(params: {
  dbServicePath: string;
  databaseUrl: string;
  run?: CommandRunner;
}): void {
  const run: CommandRunner = params.run ?? ((command, args, options) => {
    execFileSync(command, args, options);
  });
  const migrate = `Application.put_env(:dbservice, Dbservice.Repo,
    url: System.fetch_env!("DATABASE_URL"), ssl: false, pool_size: 2);
    files = Path.wildcard("priv/repo/migrations/*holistic*.exs") |> Enum.sort();
    Ecto.Migrator.with_repo(Dbservice.Repo, fn repo ->
      Enum.each(files, fn file ->
        [{module, _} | _] = Code.require_file(file);
        version = file |> Path.basename() |> String.split("_") |> hd() |> String.to_integer();
        Ecto.Migrator.up(repo, version, module, log: false)
      end)
    end)`;
  run("mix", ["run", "--no-start", "-e", migrate], {
    cwd: params.dbServicePath,
    env: { ...process.env, DATABASE_URL: params.databaseUrl },
    stdio: "inherit",
  });
}

type FixtureScope = {
  centre_id: number | string;
  school_id: number | string;
  school_code: string;
  grade_11_id: number | string;
  grade_12_id: number | string;
};

type FixtureStudent = {
  student_id: number | string;
  user_id: number | string;
  grade: number | string;
  batch_group_id: number | string;
};

export async function seedHolisticFixtures(client: Pick<PoolClient, "query">) {
  const scopeResult = await client.query<FixtureScope>(
    `/* fixture_scope */
     SELECT centre.id AS centre_id, centre.school_id, school.code AS school_code,
            (SELECT id FROM grade WHERE number = 11 ORDER BY id LIMIT 1) AS grade_11_id,
            (SELECT id FROM grade WHERE number = 12 ORDER BY id LIMIT 1) AS grade_12_id
     FROM centres centre
     JOIN school ON school.id = centre.school_id
     WHERE centre.program_id = $1 AND centre.is_active IS TRUE
       AND $1 = ANY(COALESCE(school.program_ids, '{}'))
       AND (SELECT COUNT(DISTINCT grade.number)
            FROM "group" school_group
            JOIN group_user school_member ON school_member.group_id = school_group.id
            JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = school_member.user_id
              AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = $2
              AND grade_enrollment.is_current IS TRUE
            JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number IN (11, 12)
            WHERE school_group.type = 'school' AND school_group.child_id = centre.school_id) = 2
     ORDER BY centre.school_id
     `,
    [PROGRAM_IDS.COE, HOLISTIC_FIXTURE_MANIFEST.academicYear]
  );
  let scope: FixtureScope | undefined;
  let students: FixtureStudent[] = [];
  for (const candidateScope of scopeResult.rows) {
    const studentResult = await client.query<FixtureStudent>(
      `/* fixture_students */
     WITH candidates AS (
       SELECT DISTINCT student.id AS student_id, student.user_id, grade.number AS grade,
              roster_program.batch_group_id
       FROM centres centre
       JOIN "group" school_group ON school_group.type = 'school' AND school_group.child_id = centre.school_id
       JOIN group_user school_member ON school_member.group_id = school_group.id
       JOIN student ON student.user_id = school_member.user_id
       JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = student.user_id
         AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = $2
         AND grade_enrollment.is_current IS TRUE
       JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number IN (11, 12)
       JOIN LATERAL (
         SELECT batch.program_id, batch_group.id AS batch_group_id
         FROM group_user batch_member
         JOIN "group" batch_group ON batch_group.id = batch_member.group_id AND batch_group.type = 'batch'
         JOIN batch ON batch.id = batch_group.child_id
         WHERE batch_member.user_id = student.user_id
         ORDER BY array_position(ARRAY[1, 2, 64]::int[], batch.program_id), batch_group.id
         LIMIT 1
       ) roster_program ON roster_program.program_id = $3
       WHERE centre.id = $1 AND student.status IS DISTINCT FROM 'dropout'
     ), ranked AS (
       SELECT candidates.*,
              ROW_NUMBER() OVER (PARTITION BY grade ORDER BY student_id) AS position
       FROM candidates
     )
     SELECT student_id, user_id, grade, batch_group_id FROM ranked
     WHERE position <= 3 ORDER BY grade, position`,
      [candidateScope.centre_id, HOLISTIC_FIXTURE_MANIFEST.academicYear, PROGRAM_IDS.COE]
    );
    if (studentResult.rows.filter(({ grade }) => Number(grade) === 11).length === 3 &&
        studentResult.rows.filter(({ grade }) => Number(grade) === 12).length === 3) {
      scope = candidateScope;
      students = studentResult.rows;
      break;
    }
  }
  if (!scope) throw new Error("Holistic fixtures require three eligible Program 1 Students in each Grade at one School");

  for (const student of students) {
    await client.query(
      `DELETE FROM enrollment_record
       WHERE user_id = $1 AND group_type = 'batch' AND group_id IS NULL`,
      [student.user_id]
    );
    await client.query(
      `UPDATE enrollment_record SET is_current = false, updated_at = now()
       WHERE user_id = $1 AND group_type = 'batch' AND is_current IS TRUE AND group_id <> $2`,
      [student.user_id, student.batch_group_id]
    );
    await client.query(
      `WITH updated AS (
         UPDATE enrollment_record SET is_current = true, academic_year = $3, updated_at = now()
         WHERE user_id = $1 AND group_type = 'batch' AND group_id = $2 RETURNING id
       )
       INSERT INTO enrollment_record
         (user_id, group_id, group_type, academic_year, is_current, inserted_at, updated_at)
       SELECT $1, $2, 'batch', $3, true, now(), now()
       WHERE NOT EXISTS (SELECT 1 FROM updated)`,
      [student.user_id, student.batch_group_id, HOLISTIC_FIXTURE_MANIFEST.academicYear]
    );
  }

  const actor = async (email: string, role: string, level: number, readOnly = false) => {
    const result = await client.query<{ id: number | string }>(
      `/* fixture_actor */
       WITH existing AS (
         SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) LIMIT 1
       ), created AS (
         INSERT INTO "user" (email, first_name, last_name, role, inserted_at, updated_at)
         SELECT $1, 'Synthetic', $2, $3, now(), now() WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       ), actor AS (
         SELECT id FROM created UNION ALL SELECT id FROM existing LIMIT 1
       ), permission AS (
         INSERT INTO user_permission
           (email, level, role, program_ids, school_codes, full_name, read_only, user_id, revoked_at)
         SELECT $1, $4, $3, ARRAY[$5::int], ARRAY[$6::text], CONCAT('Synthetic ', $2), $7, actor.id, NULL
         FROM actor
         ON CONFLICT (email) DO UPDATE SET level = EXCLUDED.level, role = EXCLUDED.role,
           program_ids = EXCLUDED.program_ids, school_codes = EXCLUDED.school_codes,
           read_only = EXCLUDED.read_only, user_id = EXCLUDED.user_id, revoked_at = NULL
       )
       SELECT id FROM actor`,
      [email, role.replaceAll("_", " "), role, level, PROGRAM_IDS.COE, scope.school_code, readOnly]
    );
    return Number(result.rows[0].id);
  };

  const mentorUserId = await actor("e2e-holistic-teacher@test.local", "teacher", 1);
  const formerMentorUserId = await actor("e2e-former-holistic-mentor@test.local", "teacher", 1);
  const readOnlyMentorUserId = await actor("e2e-holistic-read-only@test.local", "teacher", 1, true);
  const holisticAdminUserId = await actor("e2e-holistic-admin@test.local", "holistic_mentorship_admin", 3);
  await actor("e2e-holistic-global-admin@test.local", "admin", 3);
  await actor("e2e-holistic-pm@test.local", "program_manager", 2);
  await actor("e2e-holistic-program-admin@test.local", "program_admin", 2);

  for (const [userId, suffix] of [
    [mentorUserId, "ACTIVE"],
    [formerMentorUserId, "FORMER"],
    [readOnlyMentorUserId, "READ-ONLY"],
  ] as const) {
    await client.query(
      `WITH updated_teacher AS (
         UPDATE teacher SET is_af_teacher = true, exit_date = NULL, updated_at = now()
         WHERE user_id = $1 RETURNING user_id
       ), inserted_teacher AS (
         INSERT INTO teacher (user_id, teacher_id, is_af_teacher, inserted_at, updated_at)
         SELECT $1, $2, true, now(), now() WHERE NOT EXISTS (SELECT 1 FROM updated_teacher)
         RETURNING user_id
       ), teacher_row AS (
         SELECT user_id FROM updated_teacher UNION ALL SELECT user_id FROM inserted_teacher LIMIT 1
       ), updated_seat AS (
         UPDATE centre_positions SET role = 'subject_tbd', updated_at = now()
         WHERE centre_id = $3 AND user_id = $1 AND deleted_at IS NULL
         RETURNING id
       )
       INSERT INTO centre_positions (centre_id, role, user_id, inserted_at, updated_at)
       SELECT $3, 'subject_tbd', user_id, now(), now() FROM teacher_row
       WHERE NOT EXISTS (SELECT 1 FROM updated_seat)`,
      [userId, `E2E-HM-${suffix}`, scope.centre_id]
    );
  }

  const planResult = await client.query<{ id: number | string }>(
    `/* fixture_plan */
     WITH created AS (
       INSERT INTO holistic_mentorship_phase_plans (program_id, academic_year, inserted_at, updated_at)
       VALUES ($1, $2, now(), now()) ON CONFLICT (program_id, academic_year) DO NOTHING RETURNING id
     )
     SELECT id FROM created UNION ALL
     SELECT id FROM holistic_mentorship_phase_plans WHERE program_id = $1 AND academic_year = $2 LIMIT 1`,
    [PROGRAM_IDS.COE, HOLISTIC_FIXTURE_MANIFEST.academicYear]
  );
  const planId = Number(planResult.rows[0].id);
  await client.query(
    `INSERT INTO holistic_mentorship_phases
       (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision, inserted_at, updated_at)
     VALUES
       ($1, $2, 'Synthetic Grade 11 Completed', 1, 'open', 'Synthetic guidance only.', 1, now(), now()),
       ($1, $2, 'Synthetic Grade 11 Active', 2, 'open', 'Synthetic guidance only.', 1, now(), now()),
       ($1, $2, 'Synthetic Grade 11 Locked', 3, 'locked', 'Synthetic guidance only.', 1, now(), now()),
       ($1, $3, 'Synthetic Grade 12 Skipped', 4, 'open', 'Synthetic guidance only.', 1, now(), now()),
       ($1, $3, 'Synthetic Grade 12 Active', 5, 'open', 'Synthetic guidance only.', 1, now(), now()),
       ($1, $3, 'Synthetic Grade 12 Locked', 6, 'locked', 'Synthetic guidance only.', 1, now(), now())
     ON CONFLICT (phase_plan_id, position) DO NOTHING`,
    [planId, scope.grade_11_id, scope.grade_12_id]
  );
  const phaseResult = await client.query<{ id: number | string; position: number | string }>(
    `/* fixture_phases */ SELECT id, position FROM holistic_mentorship_phases
     WHERE phase_plan_id = $1 AND position BETWEEN 1 AND 6 ORDER BY position`,
    [planId]
  );
  if (phaseResult.rows.length !== 6) throw new Error("Current Phase Plan conflicts with deterministic fixture positions");
  const phaseByPosition = new Map(phaseResult.rows.map(({ id, position }) => [Number(position), Number(id)]));
  await client.query(
    `INSERT INTO holistic_mentorship_phase_questions (phase_id, text, position, inserted_at, updated_at)
     SELECT phase.id, 'Synthetic: What support will help next?', 1, now(), now()
     FROM holistic_mentorship_phases phase
     WHERE phase.phase_plan_id = $1 AND phase.position BETWEEN 1 AND 6
     ON CONFLICT (phase_id, position) DO UPDATE SET text = EXCLUDED.text, updated_at = now()
     WHERE EXISTS (
       SELECT 1 FROM holistic_mentorship_phases fixture_phase
       WHERE fixture_phase.id = holistic_mentorship_phase_questions.phase_id
         AND fixture_phase.title LIKE 'Synthetic %'
     )`,
    [planId]
  );
  const questionResult = await client.query<{ id: number | string; phase_id: number | string }>(
    `/* fixture_questions */ SELECT question.id, question.phase_id
     FROM holistic_mentorship_phase_questions question
     JOIN holistic_mentorship_phases phase ON phase.id = question.phase_id
     WHERE phase.phase_plan_id = $1 AND question.position = 1 ORDER BY phase.position`,
    [planId]
  );
  const questionByPhase = new Map(questionResult.rows.map(({ id, phase_id }) => [Number(phase_id), Number(id)]));
  await client.query(
    `INSERT INTO holistic_mentorship_phase_state_transitions
       (phase_id, from_state, to_state, actor_user_id, occurred_at, inserted_at, updated_at)
     SELECT phase.id, 'locked', 'open', $2,
            CASE phase.position WHEN 1 THEN '2026-05-01T00:00:00Z'::timestamptz
              WHEN 2 THEN '2026-06-01T00:00:00Z'::timestamptz
              WHEN 4 THEN '2026-05-01T00:00:00Z'::timestamptz
              ELSE '2026-06-01T00:00:00Z'::timestamptz END,
            now(), now()
     FROM holistic_mentorship_phases phase
     WHERE phase.phase_plan_id = $1 AND phase.state = 'open'
       AND NOT EXISTS (SELECT 1 FROM holistic_mentorship_phase_state_transitions existing
                       WHERE existing.phase_id = phase.id AND existing.to_state = 'open')`,
    [planId, holisticAdminUserId]
  );

  const syntheticPrompt = "Synthetic prompt only.";
  const configurationResult = await client.query<{ id: number | string }>(
    `/* fixture_configuration */
     WITH prompt AS (
       INSERT INTO holistic_mentorship_prompt_versions
         (version, template_text, template_hash, inserted_at, updated_at)
       VALUES ('synthetic-e2e-v1', $1, $2, now(), now())
       ON CONFLICT (version) DO UPDATE SET updated_at = holistic_mentorship_prompt_versions.updated_at
       RETURNING id
     ), created AS (
       INSERT INTO holistic_mentorship_prompt_configurations
         (prompt_version_id, model_id, state, inserted_at, updated_at)
       SELECT prompt.id, 'synthetic/test-model', 'active', now(), now() FROM prompt
       WHERE NOT EXISTS (SELECT 1 FROM holistic_mentorship_prompt_configurations WHERE state = 'active')
       ON CONFLICT (prompt_version_id, model_id) DO NOTHING RETURNING id
     )
     SELECT id FROM created UNION ALL
     SELECT id FROM holistic_mentorship_prompt_configurations WHERE state = 'active' LIMIT 1`,
    [syntheticPrompt, createHash("sha256").update(syntheticPrompt).digest("hex")]
  );
  const configurationId = Number(configurationResult.rows[0].id);

  const grade11 = students.filter(({ grade }) => Number(grade) === 11);
  const grade12 = students.filter(({ grade }) => Number(grade) === 12);
  await client.query(
    `INSERT INTO holistic_mentorship_mentor_mentee_mappings
       (student_id, mentor_user_id, school_id, program_id, academic_year, started_at,
        assigned_by_user_id, assignment_source, inserted_at, updated_at)
     SELECT student_id, $1, $2, $3, $4,
            CASE WHEN student_id = ANY($5::bigint[]) THEN '2026-04-01T00:00:00Z'::timestamptz
                 ELSE '2026-07-01T00:00:00Z'::timestamptz END,
            $1, 'synthetic_fixture', now(), now()
     FROM unnest($6::bigint[]) student_id
     ON CONFLICT (student_id, academic_year) WHERE ended_at IS NULL DO NOTHING`,
    [mentorUserId, scope.school_id, PROGRAM_IDS.COE, HOLISTIC_FIXTURE_MANIFEST.academicYear,
      grade11.map(({ student_id }) => Number(student_id)),
      students.filter(({ student_id }) => Number(student_id) !== Number(grade11[2].student_id)).map(({ student_id }) => Number(student_id))]
  );
  await client.query(
    `INSERT INTO holistic_mentorship_mentor_mentee_mappings
       (student_id, mentor_user_id, school_id, program_id, academic_year, started_at,
        assigned_by_user_id, assignment_source, ended_at, ended_by_user_id, end_source, end_reason,
        inserted_at, updated_at)
     SELECT $1, $2, $3, $4, $5, '2026-06-01T00:00:00Z', $2, 'synthetic_fixture',
            '2026-06-30T00:00:00Z', $2, 'mentor_removed', 'synthetic_access_loss', now(), now()
     WHERE NOT EXISTS (SELECT 1 FROM holistic_mentorship_mentor_mentee_mappings
                       WHERE student_id = $1 AND mentor_user_id = $2 AND end_reason = 'synthetic_access_loss')`,
    [grade12[2].student_id, formerMentorUserId, scope.school_id, PROGRAM_IDS.COE, HOLISTIC_FIXTURE_MANIFEST.academicYear]
  );

  await client.query(
    `WITH sources(student_id, form_id, session_id, entry_grade) AS (
       VALUES ($1::bigint, '6a44a83d1184e717b920c499', 'EnableStudents_6a44a83d1184e717b920c499', 11),
              ($2::bigint, '6a4deca8e030ebe34669fb0f', 'EnableStudents_6a4deca8e030ebe34669fb0f', 12)
     ), journeys AS (
       INSERT INTO holistic_mentorship_profile_journeys
         (student_id, form_id, af_session_id, entry_grade, inserted_at, updated_at)
       SELECT student_id, form_id, session_id, entry_grade, now(), now() FROM sources
       ON CONFLICT (student_id) DO NOTHING RETURNING id, student_id
     ), all_journeys AS (
       SELECT id, student_id FROM journeys UNION ALL
       SELECT journey.id, journey.student_id FROM holistic_mentorship_profile_journeys journey
       JOIN sources ON sources.student_id = journey.student_id
     ), profiles AS (
       INSERT INTO holistic_mentorship_student_profiles
         (profile_journey_id, prompt_configuration_id, schema_fingerprint, answer_fingerprint,
          warehouse_loaded_at, generated_at, revision, last_successful_etl_run_id, inserted_at, updated_at)
       SELECT id, $3, 'synthetic-schema-v1', CONCAT('synthetic-answer-', student_id),
              '2026-07-01T00:00:00Z', '2026-07-01T00:01:00Z', 1,
              CONCAT('synthetic-run-', student_id), now(), now()
       FROM all_journeys ON CONFLICT (profile_journey_id, prompt_configuration_id) DO NOTHING RETURNING id
     ), all_profiles AS (
       SELECT id FROM profiles UNION ALL
       SELECT profile.id FROM holistic_mentorship_student_profiles profile
       JOIN all_journeys journey ON journey.id = profile.profile_journey_id
       WHERE profile.prompt_configuration_id = $3
     )
     INSERT INTO holistic_mentorship_student_profile_summaries
       (student_profile_id, position, question_set_title, summary, inserted_at, updated_at)
     SELECT profile.id, position, CONCAT('Synthetic Question Set ', position),
            CONCAT('Synthetic summary ', position, '.'), now(), now()
     FROM all_profiles profile CROSS JOIN generate_series(1, 5) position
     ON CONFLICT (student_profile_id, position) DO NOTHING`,
    [grade11[0].student_id, grade12[0].student_id, configurationId]
  );

  await client.query(
    `WITH note AS (
       INSERT INTO holistic_mentorship_historical_notes
         (student_id, mentor_user_id, source_system, source_record_key, source_fingerprint,
          imported_by_user_id, imported_at, reconciliation_metadata, inserted_at, updated_at)
       VALUES ($1, NULL, 'synthetic_fixture', 'synthetic-grade12-history',
         'synthetic-history-fingerprint', $2, '2026-07-01T00:00:00Z',
         '{"synthetic":true}'::jsonb, now(), now())
       ON CONFLICT (student_id, source_system) DO NOTHING RETURNING id
     ), selected AS (
       SELECT id FROM note UNION ALL SELECT id FROM holistic_mentorship_historical_notes
       WHERE student_id = $1 AND source_system = 'synthetic_fixture' LIMIT 1
     )
     INSERT INTO holistic_mentorship_historical_note_answers
       (historical_note_id, position, question, answer, inserted_at, updated_at)
     SELECT selected.id, position, CONCAT('Synthetic historical question ', position, '?'),
            CASE WHEN position = 4 THEN NULL ELSE CONCAT('Synthetic historical answer ', position, '.') END,
            now(), now()
     FROM selected CROSS JOIN generate_series(1, 4) position
     ON CONFLICT (historical_note_id, position) DO NOTHING`,
    [grade12[0].student_id, holisticAdminUserId]
  );

  const completedPhaseId = phaseByPosition.get(1)!;
  const draftPhaseId = phaseByPosition.get(2)!;
  await client.query(
    `WITH source(student_id, phase_id, state, submitted_at, edited_at) AS (
       VALUES ($1::bigint, $2::bigint, 'submitted', '2026-06-05T00:05:00Z'::timestamptz, '2026-06-05T00:05:00Z'::timestamptz),
              ($3::bigint, $4::bigint, 'draft', NULL::timestamptz, '2026-07-01T00:05:00Z'::timestamptz)
     ), notes AS (
       INSERT INTO holistic_mentorship_post_session_notes
         (student_id, phase_id, author_user_id, state, revision, first_drafted_at,
          first_submitted_at, last_edited_at, inserted_at, updated_at)
       SELECT student_id, phase_id, $5, state, 1, edited_at - interval '5 minutes', submitted_at, edited_at, now(), now()
       FROM source ON CONFLICT (student_id, phase_id) DO NOTHING RETURNING id, phase_id
     ), all_notes AS (
       SELECT id, phase_id FROM notes UNION ALL
       SELECT existing.id, existing.phase_id FROM holistic_mentorship_post_session_notes existing
       JOIN source ON source.student_id = existing.student_id AND source.phase_id = existing.phase_id
     )
     INSERT INTO holistic_mentorship_post_session_answers
       (notes_id, question_id, answer, inserted_at, updated_at)
     SELECT notes.id, CASE notes.phase_id WHEN $2 THEN $6::bigint ELSE $7::bigint END,
            'Synthetic mentoring note.', now(), now()
     FROM all_notes notes ON CONFLICT (notes_id, question_id) DO NOTHING`,
    [grade11[0].student_id, completedPhaseId, grade11[1].student_id, draftPhaseId,
      mentorUserId, questionByPhase.get(completedPhaseId), questionByPhase.get(draftPhaseId)]
  );
  await client.query(
    `UPDATE holistic_mentorship_phases SET frozen_at = COALESCE(frozen_at, '2026-06-05T00:00:00Z'),
       frozen_by_user_id = COALESCE(frozen_by_user_id, $2), updated_at = now()
     WHERE id = ANY($1::bigint[])`,
    [[completedPhaseId, draftPhaseId], mentorUserId]
  );

  return {
    schoolCode: scope.school_code,
    academicYear: HOLISTIC_FIXTURE_MANIFEST.academicYear,
    students: 6,
    mappings: 5,
    profiles: 2,
    historicalNotes: 1,
    draftNotes: 1,
    submittedNotes: 1,
    phases: 6,
  };
}
