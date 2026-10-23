// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Explicitly opt in with a migrated, disposable local DB. Synthetic immutable
// audit rows intentionally remain; drop the disposable DB to remove fixtures.
// The DB must include db-service #806 (post-session Challenge Category rows).
// HOLISTIC_PRIVACY_TEST_DATABASE=dbservice_test_lms412 DATABASE_HOST=localhost \
// DATABASE_USER=postgres DATABASE_PASSWORD=postgres npx vitest run src/lib/holistic-privacy.integration.test.ts
const database = process.env.HOLISTIC_PRIVACY_TEST_DATABASE;
const marker = "Content erased under approved privacy request";
const runId = randomUUID();
let db: typeof import("./db");
let erase: typeof import("./holistic-privacy").deleteHolisticStudentContent;
let mappings: typeof import("./holistic-mappings");
let reconcile: typeof import("./holistic-reconciliation").reconcileHolisticMappings;
let actorUserId: number;
let programId: number;
let schoolId: number;
let phases: { id: number; questionId: number }[];
let promptConfigurationId: number;
let triggerInstalled = false;

async function insertId(client: PoolClient, sql: string, params: unknown[] = []) {
  const result = await client.query<{ id: string | number }>(sql, params);
  return Number(result.rows[0].id);
}

async function seedStudent(withOtherContent = false) {
  return db.withTransaction(async (client) => {
    const userId = await insertId(client,
      'INSERT INTO "user" (inserted_at, updated_at) VALUES (now(), now()) RETURNING id');
    const studentId = await insertId(client,
      "INSERT INTO student (user_id, inserted_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [userId]);
    for (const phase of phases) {
      const notesId = await insertId(client,
        `INSERT INTO holistic_mentorship_post_session_notes
           (student_id, phase_id, author_user_id, state, revision,
            first_drafted_at, first_submitted_at, last_edited_at)
         VALUES ($1, $2, $3, 'submitted', 1, now(), now(), now()) RETURNING id`,
        [studentId, phase.id, actorUserId]);
      if (withOtherContent) {
        await client.query(
          `INSERT INTO holistic_mentorship_post_session_answers (notes_id, question_id, answer)
           VALUES ($1, $2, 'Synthetic post-session answer')`, [notesId, phase.questionId]);
      }
    }
    if (withOtherContent) {
      const historicalId = await insertId(client,
        `INSERT INTO holistic_mentorship_historical_notes
           (student_id, source_system, source_record_key, source_fingerprint,
            imported_by_user_id, imported_at, reconciliation_metadata)
         VALUES ($1, 'issue412', $2, 'synthetic', $3, now(), '{}') RETURNING id`,
        [studentId, randomUUID(), actorUserId]);
      await client.query(
        `INSERT INTO holistic_mentorship_historical_note_answers
           (historical_note_id, position, question, answer)
         SELECT $1, position, 'Synthetic question',
           CASE WHEN position = 4 THEN NULL ELSE 'Synthetic historical answer' END
         FROM generate_series(1, 4) AS position`, [historicalId]);
      const journeyId = await insertId(client,
        `INSERT INTO holistic_mentorship_profile_journeys
           (student_id, form_id, af_session_id, entry_grade)
         VALUES ($1, '6a44a83d1184e717b920c499', 'EnableStudents_6a44a83d1184e717b920c499', 11)
         RETURNING id`, [studentId]);
      const profileId = await insertId(client,
        `INSERT INTO holistic_mentorship_student_profiles
           (profile_journey_id, prompt_configuration_id, schema_fingerprint, answer_fingerprint,
            warehouse_loaded_at, generated_at, revision, last_successful_etl_run_id)
         VALUES ($1, $2, 'synthetic', 'synthetic', now(), now(), 1, $3) RETURNING id`,
        [journeyId, promptConfigurationId, runId]);
      await client.query(
        `INSERT INTO holistic_mentorship_student_profile_summaries
           (student_profile_id, position, question_set_title, summary)
         SELECT $1, position, 'Synthetic theme', 'Synthetic profile summary'
         FROM generate_series(1, 5) AS position`, [profileId]);
    }
    return studentId;
  });
}

const followUpInsert = `INSERT INTO holistic_mentorship_follow_up_notes
  (student_id, phase_id, author_user_id, author_email,
   challenges_answer, solutions_answer, action_plan_answer, submitted_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`;

function followUpParams(studentId: number, phaseIndex = 0,
  answers: (string | null)[] = ["Synthetic challenge", null, null]) {
  return [studentId, phases[phaseIndex].id, actorUserId, `issue412-${runId}@example.test`, ...answers];
}

async function followUp(studentId: number, phaseIndex = 0,
  answers: (string | null)[] = ["Synthetic challenge", null, null]) {
  return db.query(followUpInsert, followUpParams(studentId, phaseIndex, answers));
}

async function followUps(studentId: number) {
  return db.query<{ row: Record<string, unknown> }>(
    `SELECT to_jsonb(notes) AS row FROM holistic_mentorship_follow_up_notes notes
     WHERE student_id = $1 ORDER BY id`, [studentId]);
}

async function tombstones(studentId: number) {
  return db.query<{ row: Record<string, unknown> }>(
    `SELECT to_jsonb(deletion) AS row FROM holistic_mentorship_privacy_deletions deletion
     WHERE student_id = $1`, [studentId]);
}

async function audits(studentId: number) {
  return db.query<{ row: Record<string, unknown> }>(
    `SELECT to_jsonb(audit) AS row FROM holistic_mentorship_follow_up_erasures audit
     JOIN holistic_mentorship_privacy_deletions deletion ON deletion.id = audit.privacy_deletion_id
     WHERE deletion.student_id = $1`, [studentId]);
}

async function otherContent(studentId: number) {
  const [result] = await db.query<{
    summaries: string[]; historical: (string | null)[]; post_session: string[];
    revisions: number[]; audit_count: number;
  }>(`SELECT
    ARRAY(SELECT summary.summary FROM holistic_mentorship_student_profile_summaries summary
      JOIN holistic_mentorship_student_profiles profile ON profile.id = summary.student_profile_id
      JOIN holistic_mentorship_profile_journeys journey ON journey.id = profile.profile_journey_id
      WHERE journey.student_id = $1 ORDER BY summary.position) AS summaries,
    ARRAY(SELECT answer.answer FROM holistic_mentorship_historical_note_answers answer
      JOIN holistic_mentorship_historical_notes notes ON notes.id = answer.historical_note_id
      WHERE notes.student_id = $1 ORDER BY answer.position) AS historical,
    ARRAY(SELECT answer.answer FROM holistic_mentorship_post_session_answers answer
      JOIN holistic_mentorship_post_session_notes notes ON notes.id = answer.notes_id
      WHERE notes.student_id = $1 ORDER BY notes.id) AS post_session,
    ARRAY(SELECT revision FROM holistic_mentorship_post_session_notes
      WHERE student_id = $1 ORDER BY id) AS revisions,
    (SELECT count(*)::integer FROM holistic_mentorship_post_session_note_audits audit
      JOIN holistic_mentorship_post_session_notes notes ON notes.id = audit.notes_id
      WHERE notes.student_id = $1) AS audit_count`, [studentId]);
  return result;
}

async function seedNotes(studentId: number, phaseIndex: number, state: "draft" | "submitted",
  content: { answer?: string; categories?: string[] } = {}, authorUserId = actorUserId) {
  return db.withTransaction(async (client) => {
    const notesId = await insertId(client,
      `INSERT INTO holistic_mentorship_post_session_notes
         (student_id, phase_id, author_user_id, state, revision,
          first_drafted_at, first_submitted_at, last_edited_at)
       VALUES ($1, $2, $3, $4::text, 1, now(), CASE WHEN $4::text = 'submitted' THEN now() END, now())
       RETURNING id`,
      [studentId, phases[phaseIndex].id, authorUserId, state]);
    if (content.answer) {
      await client.query(
        `INSERT INTO holistic_mentorship_post_session_answers (notes_id, question_id, answer)
         VALUES ($1, $2, $3)`, [notesId, phases[phaseIndex].questionId, content.answer]);
    }
    for (const code of content.categories ?? []) {
      await client.query(
        `INSERT INTO holistic_mentorship_post_session_note_challenges (notes_id, category_code)
         VALUES ($1, $2)`, [notesId, code]);
    }
    return notesId;
  });
}

async function seedBareStudent() {
  return db.withTransaction(async (client) => {
    const userId = await insertId(client,
      'INSERT INTO "user" (inserted_at, updated_at) VALUES (now(), now()) RETURNING id');
    return insertId(client,
      "INSERT INTO student (user_id, inserted_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [userId]);
  });
}

async function notesContent(notesId: number) {
  const [result] = await db.query<{
    categories: string[]; answers: string[]; revision: number; audits: string[];
  }>(`SELECT
    ARRAY(SELECT category_code FROM holistic_mentorship_post_session_note_challenges
      WHERE notes_id = $1 ORDER BY category_code) AS categories,
    ARRAY(SELECT answer FROM holistic_mentorship_post_session_answers
      WHERE notes_id = $1 ORDER BY id) AS answers,
    (SELECT revision FROM holistic_mentorship_post_session_notes WHERE id = $1) AS revision,
    ARRAY(SELECT action FROM holistic_mentorship_post_session_note_audits
      WHERE notes_id = $1 ORDER BY id) AS audits`, [notesId]);
  return result;
}

// Observe actual blocked database statements, rather than assuming a sleep
// means the second transaction has reached its advisory lock.
async function waitForLockWaiters(key: number, subkey: number, count = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM pg_locks
       WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid
         AND objsubid = 2 AND NOT granted AND database =
           (SELECT oid FROM pg_database WHERE datname = current_database())`, [key, subkey]);
    if (row.count >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected database advisory-lock waiter did not arrive");
}

const request = (studentId: number, reason = "Synthetic approved issue412 request") =>
  erase({ studentId, actorUserId, reason });

// Skipping does not import db.ts, construct a pool, or load application DB env.
describe.skipIf(!database)("Holistic privacy erasure against disposable Postgres", () => {
  beforeAll(async () => {
    const host = process.env.DATABASE_HOST || "localhost";
    if (!database || !/^dbservice_test_[a-z0-9_]+$/.test(database)
      || !["localhost", "127.0.0.1"].includes(host)) {
      throw new Error("Integration tests require a localhost/127.0.0.1 host and dbservice_test_ database name");
    }
    if ((globalThis as { pool?: unknown }).pool) {
      throw new Error("Integration tests must start before the database singleton is initialized");
    }
    process.env.DATABASE_HOST = host;
    process.env.DATABASE_NAME = database;
    process.env.DATABASE_SSL = "false";
    process.env.DATABASE_POOL_MAX = "10";
    db = await import("./db");
    erase = (await import("./holistic-privacy")).deleteHolisticStudentContent;
    mappings = await import("./holistic-mappings");
    reconcile = (await import("./holistic-reconciliation")).reconcileHolisticMappings;
    const [connection] = await db.query<{ name: string; address: string }>(
      "SELECT current_database() AS name, host(inet_server_addr()) AS address");
    expect(connection.name).toBe(database);
    expect(["127.0.0.1", "::1"]).toContain(connection.address);
    await db.query("SELECT 1 FROM holistic_mentorship_follow_up_erasures LIMIT 0");

    await db.withTransaction(async (client) => {
      actorUserId = await insertId(client,
        'INSERT INTO "user" (inserted_at, updated_at) VALUES (now(), now()) RETURNING id');
      await client.query(
        `INSERT INTO user_permission (email, level, role, user_id, read_only)
         VALUES ($1, 3, 'admin', $2, false)`, [`issue412-${runId}@example.test`, actorUserId]);
      const productId = await insertId(client,
        "INSERT INTO product (name, inserted_at, updated_at) VALUES ('Issue412 synthetic', now(), now()) RETURNING id");
      programId = await insertId(client,
        "INSERT INTO program (name, product_id, inserted_at, updated_at) VALUES ('Issue412 synthetic', $1, now(), now()) RETURNING id", [productId]);
      const gradeId = await insertId(client,
        "INSERT INTO grade (number, inserted_at, updated_at) VALUES (11, now(), now()) RETURNING id");
      schoolId = await insertId(client,
        "INSERT INTO school (name, inserted_at, updated_at) VALUES ('Issue412 synthetic', now(), now()) RETURNING id");
      const planId = await insertId(client,
        "INSERT INTO holistic_mentorship_phase_plans (program_id, academic_year) VALUES ($1, '2026-2027') RETURNING id", [programId]);
      phases = [];
      for (const position of [1, 2]) {
        const id = await insertId(client,
          `INSERT INTO holistic_mentorship_phases
             (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision)
           VALUES ($1, $2, 'Synthetic phase', $3, 'open', 'Synthetic guidance', 1) RETURNING id`,
          [planId, gradeId, position]);
        const questionId = await insertId(client,
          "INSERT INTO holistic_mentorship_phase_questions (phase_id, text, position) VALUES ($1, 'Synthetic question', 1) RETURNING id", [id]);
        phases.push({ id, questionId });
      }
      const versionId = await insertId(client,
        `INSERT INTO holistic_mentorship_prompt_versions (version, template_text, template_hash)
         VALUES ($1, 'Synthetic prompt', 'synthetic') RETURNING id`, [runId]);
      promptConfigurationId = await insertId(client,
        `INSERT INTO holistic_mentorship_prompt_configurations (prompt_version_id, model_id, state)
         VALUES ($1, 'synthetic', 'inactive') RETURNING id`, [versionId]);
    });

    // Dedicated disposable DB only: deterministic failure/pause after the actual
    // Follow-up UPDATE, while still inside the application's transaction.
    await db.withTransaction(async (client) => {
      await client.query(`CREATE FUNCTION issue412_test_audit_hook() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.reason = 'issue412 fail audit' THEN
            RAISE EXCEPTION 'issue412 injected audit failure';
          ELSIF NEW.reason = 'issue412 pause erasure' THEN
            PERFORM pg_advisory_xact_lock(412, 1);
          END IF;
          RETURN NEW;
        END;
      $$`);
      await client.query(`CREATE TRIGGER issue412_test_audit_hook
        BEFORE INSERT ON holistic_mentorship_follow_up_erasures
        FOR EACH ROW EXECUTE FUNCTION issue412_test_audit_hook()`);
    });
    triggerInstalled = true;
  }, 20000);

  afterAll(async () => {
    if (!db) return;
    try {
      if (triggerInstalled) {
        await db.withTransaction(async (client) => {
          await client.query("DROP TRIGGER issue412_test_audit_hook ON holistic_mentorship_follow_up_erasures");
          await client.query("DROP FUNCTION issue412_test_audit_hook()");
        });
      }
    } finally {
      await db.default.end();
      delete (globalThis as { pool?: unknown }).pool;
    }
  });

  it("erases every content family, counts individual pending fields, preserves metadata/nulls, and replays", async () => {
    const studentId = await seedStudent(true);
    const unrelatedId = await seedStudent(true);
    await followUp(studentId, 0, ["Challenge A", null, "Plan A"]);
    await followUp(studentId, 0, [marker, "Solution B", null]);
    await followUp(studentId, 1, ["Challenge C", "Solution C", "Plan C"]);
    await followUp(studentId, 1, [marker, null, marker]);
    await followUp(unrelatedId);
    const before = await followUps(studentId);
    const unrelatedBefore = { followUps: await followUps(unrelatedId), content: await otherContent(unrelatedId) };

    expect(await request(studentId)).toEqual({ ok: true, profileSummariesErased: 5,
      historicalAnswersErased: 3, postSessionAnswersErased: 2, followUpAnswersErased: 6 });
    expect(await followUps(studentId)).toEqual(before.map(({ row }) => ({ row: {
      ...row,
      challenges_answer: row.challenges_answer === null ? null : marker,
      solutions_answer: row.solutions_answer === null ? null : marker,
      action_plan_answer: row.action_plan_answer === null ? null : marker,
    } })));
    expect(await otherContent(studentId)).toEqual({ summaries: Array(5).fill(marker),
      historical: [null, null, null, null], post_session: [], revisions: [2, 2], audit_count: 2 });
    expect({ followUps: await followUps(unrelatedId), content: await otherContent(unrelatedId) }).toEqual(unrelatedBefore);
    const originalTombstone = await tombstones(studentId);
    const originalAudit = await audits(studentId);
    expect(originalTombstone).toHaveLength(1);
    expect(originalTombstone[0].row).toMatchObject({ student_id: studentId,
      profile_summaries_erased: 5, historical_answers_erased: 3, post_session_answers_erased: 2 });
    expect(originalAudit).toHaveLength(1);
    expect(originalAudit[0].row).toMatchObject({ actor_user_id: actorUserId, answers_erased: 6,
      privacy_deletion_id: originalTombstone[0].row.id, reason: "Synthetic approved issue412 request" });
    expect(await request(studentId)).toEqual({ ok: true, profileSummariesErased: 0,
      historicalAnswersErased: 0, postSessionAnswersErased: 0, followUpAnswersErased: 0 });
    expect(await tombstones(studentId)).toEqual(originalTombstone);
    expect(await audits(studentId)).toEqual(originalAudit);
    expect((await otherContent(studentId)).audit_count).toBe(2);
  });

  it("erases Challenge Category rows, including Categories-only Notes, before the tombstone", async () => {
    const studentId = await seedBareStudent();
    const unrelatedId = await seedBareStudent();
    const answered = await seedNotes(studentId, 0, "submitted", {
      answer: "Synthetic post-session answer",
      categories: ["academic.subject_concept", "non_academic.financial"],
    });
    const categoriesOnly = await seedNotes(studentId, 1, "draft", {
      categories: ["academic.no_major_issue"],
    });
    const unrelated = await seedNotes(unrelatedId, 0, "submitted", {
      answer: "Unrelated answer", categories: ["non_academic.wellness"],
    });

    expect(await request(studentId)).toMatchObject({ ok: true, postSessionAnswersErased: 1 });
    expect(await notesContent(answered)).toEqual({
      categories: [], answers: [], revision: 2, audits: ["privacy_content_erased"] });
    expect(await notesContent(categoriesOnly)).toEqual({
      categories: [], answers: [], revision: 2, audits: ["privacy_content_erased"] });
    expect(await notesContent(unrelated)).toEqual({
      categories: ["non_academic.wellness"], answers: ["Unrelated answer"], revision: 1, audits: [] });
    expect((await tombstones(studentId))[0].row).toMatchObject({ post_session_answers_erased: 1 });
  });

  it("rejects a Challenge Category insert for a tombstoned Student", async () => {
    const studentId = await seedBareStudent();
    const notesId = await seedNotes(studentId, 0, "draft", { categories: ["academic.other"] });
    expect(await request(studentId)).toMatchObject({ ok: true });
    await expect(db.query(
      `INSERT INTO holistic_mentorship_post_session_note_challenges (notes_id, category_code)
       VALUES ($1, 'academic.exam_related')`, [notesId],
    )).rejects.toMatchObject({ code: "23514" });
    expect((await notesContent(notesId)).categories).toEqual([]);
  });

  async function seedMapping(studentId: number) {
    return db.withTransaction((client) => insertId(client,
      `INSERT INTO holistic_mentorship_mentor_mentee_mappings
         (student_id, mentor_user_id, school_id, program_id, academic_year, started_at, assignment_source)
       VALUES ($1, $2, $3, $4, '2026-2027', now(), 'af_lms_teacher') RETURNING id`,
      [studentId, actorUserId, schoolId, programId]));
  }

  const draftErasurePaths: [string, (studentId: number) => Promise<unknown>][] = [
    ["Mapping end", (studentId) => db.withTransaction((client) =>
      mappings.eraseDraftHolisticNotes(client, [studentId], actorUserId, "teacher_removal"))],
    ["Mapping-scoped Mentor removal", async (studentId) => {
      const expectedMappingId = await seedMapping(studentId);
      expect(await mappings.removeHolisticMenteeAsAdmin({
        actorEmail: `issue412-${runId}@example.test`, auditActorUserId: actorUserId,
        schoolId, programId, academicYear: "2026-2027", studentId, expectedMappingId,
        confirmed: true, reason: "Synthetic admin removal",
      })).toEqual({ ok: true, changed: 1 });
    }],
    ["reconciliation of an ended Mapping", async (studentId) => {
      await seedMapping(studentId);
      expect(await reconcile({ programId, studentIds: [studentId] })).toBe(1);
    }],
  ];

  it.each(draftErasurePaths)("erases draft Challenge Category rows on %s", async (_path, endMapping) => {
    const studentId = await seedBareStudent();
    const otherId = await seedBareStudent();
    const draft = await seedNotes(studentId, 0, "draft", {
      answer: "Synthetic draft answer", categories: ["academic.exam_related", "non_academic.adjustment"],
    });
    const submitted = await seedNotes(studentId, 1, "submitted", {
      answer: "Synthetic submitted answer", categories: ["academic.other"],
    });
    const otherDraft = await seedNotes(otherId, 0, "draft", { categories: ["non_academic.other"] });

    await endMapping(studentId);

    expect(await notesContent(draft)).toEqual({
      categories: [], answers: [], revision: 2, audits: ["draft_erased_on_mapping_end"] });
    expect(await notesContent(submitted)).toEqual({
      categories: ["academic.other"], answers: ["Synthetic submitted answer"], revision: 1, audits: [] });
    expect(await notesContent(otherDraft)).toEqual({
      categories: ["non_academic.other"], answers: [], revision: 1, audits: [] });
  });

  it("records a repair under an existing tombstone without rewriting original audit history", async () => {
    const studentId = await seedStudent();
    await followUp(studentId, 1, [null, "Legacy pending solution", "Legacy pending plan"]);
    const originalActor = await db.withTransaction((client) => insertId(client,
      'INSERT INTO "user" (inserted_at, updated_at) VALUES (now(), now()) RETURNING id'));
    await db.query(`INSERT INTO holistic_mentorship_privacy_deletions
      (student_id, actor_user_id, reason, profile_summaries_erased, post_session_answers_erased,
       historical_answers_erased, occurred_at)
      VALUES ($1, $2, 'Original approved request', 5, 2, 4, '2026-09-01')`, [studentId, originalActor]);
    const before = await tombstones(studentId);
    expect(await request(studentId, "Synthetic follow-up repair")).toMatchObject({ ok: true, followUpAnswersErased: 2 });
    expect(await tombstones(studentId)).toEqual(before);
    expect((await audits(studentId))[0].row).toMatchObject({ answers_erased: 2,
      privacy_deletion_id: before[0].row.id, actor_user_id: actorUserId, reason: "Synthetic follow-up repair" });
  });

  it("creates no companion audit for marker-only content", async () => {
    const studentId = await seedStudent();
    await followUp(studentId, 0, [marker, null, marker]);
    const before = await followUps(studentId);
    expect(await request(studentId)).toMatchObject({ ok: true, followUpAnswersErased: 0 });
    expect(await followUps(studentId)).toEqual(before);
    expect(await audits(studentId)).toEqual([]);
    expect(await tombstones(studentId)).toHaveLength(1);
  });

  it("rolls back all content erasures and audits when companion audit insertion fails", async () => {
    const studentId = await seedStudent(true);
    await followUp(studentId);
    const before = { followUps: await followUps(studentId), content: await otherContent(studentId) };
    await expect(request(studentId, "issue412 fail audit")).rejects.toThrow("issue412 injected audit failure");
    expect({ followUps: await followUps(studentId), content: await otherContent(studentId) }).toEqual(before);
    expect(await tombstones(studentId)).toEqual([]);
    expect(await audits(studentId)).toEqual([]);
    expect(await request(studentId)).toMatchObject({ ok: true, followUpAnswersErased: 1 });
  });

  it("serializes two erasures into one change and one replay", async () => {
    const studentId = await seedStudent();
    await followUp(studentId);
    const blocker = await db.default.connect();
    const pending: Promise<Awaited<ReturnType<typeof request>>>[] = [];
    try {
      await blocker.query("SELECT pg_advisory_lock($1, 0)", [studentId]);
      pending.push(request(studentId));
      await waitForLockWaiters(studentId, 0);
      pending.push(request(studentId));
      await waitForLockWaiters(studentId, 0, 2);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock($1, 0)", [studentId]);
      blocker.release();
      await Promise.allSettled(pending);
    }
    const results = await Promise.all(pending);
    expect(results).toEqual([
      expect.objectContaining({ ok: true, followUpAnswersErased: 1 }),
      expect.objectContaining({ ok: true, followUpAnswersErased: 0 }),
    ]);
    expect(await audits(studentId)).toHaveLength(1);
  }, 15000);

  it("erases a Follow-up insert that acquired the privacy lock first", async () => {
    const studentId = await seedStudent();
    const writer = await db.default.connect();
    let pending: ReturnType<typeof request> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query(followUpInsert, followUpParams(studentId));
      pending = request(studentId);
      await waitForLockWaiters(studentId, 0);
      await writer.query("COMMIT");
      expect(await pending).toMatchObject({ ok: true, followUpAnswersErased: 1 });
      expect((await followUps(studentId))[0].row.challenges_answer).toBe(marker);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
      if (pending) await Promise.allSettled([pending]);
    }
  }, 15000);

  it("rejects a Follow-up insert waiting behind a committed erasure", async () => {
    const studentId = await seedStudent();
    await followUp(studentId);
    const blocker = await db.default.connect();
    let pendingErase: ReturnType<typeof request> | undefined;
    let pendingInsert: Promise<unknown> | undefined;
    try {
      await blocker.query("SELECT pg_advisory_lock(412, 1)");
      pendingErase = request(studentId, "issue412 pause erasure");
      await waitForLockWaiters(412, 1);
      // Attach the rejection handler immediately, before releasing the blocker.
      pendingInsert = expect(followUp(studentId, 1)).rejects.toMatchObject({ code: "23514" });
      await waitForLockWaiters(studentId, 0);
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(412, 1)");
      blocker.release();
      await Promise.allSettled([pendingErase, pendingInsert].filter(Boolean));
    }
    expect(await pendingErase).toMatchObject({ ok: true, followUpAnswersErased: 1 });
    await pendingInsert;
    expect(await followUps(studentId)).toHaveLength(1);
    expect(await audits(studentId)).toHaveLength(1);
  }, 15000);
});
