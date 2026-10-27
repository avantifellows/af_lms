// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Explicitly opt in with a migrated, disposable local DB that includes
// db-service #806 (post-session Challenge Category rows). Synthetic rows remain;
// drop the disposable DB to remove them.
// HOLISTIC_NOTES_TEST_DATABASE=dbservice_test_lms457 DATABASE_HOST=localhost \
// DATABASE_USER=postgres DATABASE_PASSWORD=postgres npx vitest run src/lib/holistic-notes.integration.test.ts
const database = process.env.HOLISTIC_NOTES_TEST_DATABASE;
const academicYear = "2026-2027";
const runId = randomUUID();
let db: typeof import("./db");
let save: typeof import("./holistic-notes").saveHolisticNotes;
let readStudentPhase: typeof import("./holistic-student-phase").getHolisticStudentPhase;
let eraseDraft: typeof import("./holistic-mappings").eraseDraftHolisticNotes;
let firstMentorId: number;
let replacementMentorId: number;
let programId: number;
let schoolId: number;
let gradeId: number;
let schoolGroupId: number;
let batchGroupId: number;
let planId: number;

async function insertId(client: PoolClient, sql: string, params: unknown[] = []) {
  const result = await client.query<{ id: string | number }>(sql, params);
  return Number(result.rows[0].id);
}

async function seedPhase(position: number) {
  return db.withTransaction(async (client) => {
    const phaseId = await insertId(client,
      `INSERT INTO holistic_mentorship_phases
         (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision)
       VALUES ($1, $2, 'Synthetic phase', $3, 'open', 'Synthetic guidance', 1) RETURNING id`,
      [planId, gradeId, position]);
    const questionId = await insertId(client,
      `INSERT INTO holistic_mentorship_phase_questions (phase_id, text, position)
       VALUES ($1, 'Describe the academic challenges the student shared', 1) RETURNING id`, [phaseId]);
    return { phaseId, questionId };
  });
}

// A current Grade 11 roster Student mapped to the first Mentor.
async function seedMentee() {
  return db.withTransaction(async (client) => {
    const userId = await insertId(client,
      `INSERT INTO "user" (first_name, inserted_at, updated_at)
       VALUES ('Issue457 synthetic', now(), now()) RETURNING id`);
    const studentId = await insertId(client,
      "INSERT INTO student (user_id, inserted_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [userId]);
    for (const groupId of [schoolGroupId, batchGroupId]) {
      await client.query("INSERT INTO group_user (user_id, group_id) VALUES ($1, $2)", [userId, groupId]);
    }
    await client.query(
      `INSERT INTO enrollment_record
         (user_id, group_type, group_id, academic_year, is_current, inserted_at, updated_at)
       VALUES ($1, 'grade', $2, $3, true, now(), now())`, [userId, gradeId, academicYear]);
    const mappingId = await insertId(client,
      `INSERT INTO holistic_mentorship_mentor_mentee_mappings
         (student_id, mentor_user_id, school_id, program_id, academic_year, started_at, assignment_source)
       VALUES ($1, $2, $3, $4, $5, now() - interval '1 day', 'issue457_test') RETURNING id`,
      [studentId, firstMentorId, schoolId, programId, academicYear]);
    return { studentId, mappingId };
  });
}

async function replaceMentor(studentId: number, mappingId: number) {
  await db.withTransaction(async (client) => {
    await client.query(
      `UPDATE holistic_mentorship_mentor_mentee_mappings
       SET ended_at = now(), end_source = 'issue457_test', end_reason = 'reassigned'
       WHERE id = $1`, [mappingId]);
    await client.query(
      `INSERT INTO holistic_mentorship_mentor_mentee_mappings
         (student_id, mentor_user_id, school_id, program_id, academic_year, started_at, assignment_source)
       VALUES ($1, $2, $3, $4, $5, now(), 'issue457_test')`,
      [studentId, replacementMentorId, schoolId, programId, academicYear]);
  });
}

function draft(target: { studentId: number; phaseId: number; questionId: number }, values: {
  actorUserId?: number; expectedRevision: number; answer?: string; challengeCategories: string[];
}) {
  return save({
    mode: "draft",
    studentId: target.studentId,
    phaseId: target.phaseId,
    schoolId,
    programId,
    academicYear,
    actorUserId: values.actorUserId ?? firstMentorId,
    expectedRevision: values.expectedRevision,
    answers: [{ questionId: target.questionId, answer: values.answer ?? "" }],
    challengeCategories: values.challengeCategories,
  });
}

async function mentorView(studentId: number, phaseId: number, actorUserId = firstMentorId) {
  const detail = await readStudentPhase({
    studentId, phaseId, schoolId, programId, academicYear, actorUserId, role: "teacher", canEdit: true,
  });
  return detail!.selectedPhase as Record<string, unknown> & { notes: Record<string, unknown> | null };
}

async function phaseFrozen(phaseId: number) {
  const [row] = await db.query<{ frozen: boolean }>(
    "SELECT frozen_at IS NOT NULL AS frozen FROM holistic_mentorship_phases WHERE id = $1", [phaseId]);
  return row.frozen;
}

// Skipping does not import db.ts, construct a pool, or load application DB env.
describe.skipIf(!database)("Holistic Post-Session Notes Challenge Categories against disposable Postgres", () => {
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
    db = await import("./db");
    save = (await import("./holistic-notes")).saveHolisticNotes;
    readStudentPhase = (await import("./holistic-student-phase")).getHolisticStudentPhase;
    eraseDraft = (await import("./holistic-mappings")).eraseDraftHolisticNotes;
    const [connection] = await db.query<{ name: string; address: string }>(
      "SELECT current_database() AS name, host(inet_server_addr()) AS address");
    expect(connection.name).toBe(database);
    expect(["127.0.0.1", "::1"]).toContain(connection.address);
    await db.query("SELECT 1 FROM holistic_mentorship_post_session_note_challenges LIMIT 0");

    await db.withTransaction(async (client) => {
      const mentor = (name: string) => insertId(client,
        `INSERT INTO "user" (first_name, email, inserted_at, updated_at)
         VALUES ($1, $2, now(), now()) RETURNING id`, [name, `issue457-${name}-${runId}@example.test`]);
      firstMentorId = await mentor("first");
      replacementMentorId = await mentor("replacement");
      const productId = await insertId(client,
        "INSERT INTO product (name, inserted_at, updated_at) VALUES ('Issue457 synthetic', now(), now()) RETURNING id");
      programId = await insertId(client,
        "INSERT INTO program (name, product_id, inserted_at, updated_at) VALUES ('Issue457 synthetic', $1, now(), now()) RETURNING id", [productId]);
      gradeId = await insertId(client,
        "INSERT INTO grade (number, inserted_at, updated_at) VALUES (11, now(), now()) RETURNING id");
      schoolId = await insertId(client,
        "INSERT INTO school (name, inserted_at, updated_at) VALUES ('Issue457 synthetic', now(), now()) RETURNING id");
      schoolGroupId = await insertId(client,
        `INSERT INTO "group" (type, child_id, inserted_at, updated_at)
         VALUES ('school', $1, now(), now()) RETURNING id`, [schoolId]);
      const batchId = await insertId(client,
        `INSERT INTO batch (name, program_id, inserted_at, updated_at)
         VALUES ('Issue457 synthetic', $1, now(), now()) RETURNING id`, [programId]);
      batchGroupId = await insertId(client,
        `INSERT INTO "group" (type, child_id, inserted_at, updated_at)
         VALUES ('batch', $1, now(), now()) RETURNING id`, [batchId]);
      await client.query(
        `INSERT INTO centres (name, school_id, program_id, is_physical, is_active)
         VALUES ('Issue457 synthetic', $1, $2, true, true)`, [schoolId, programId]);
      planId = await insertId(client,
        "INSERT INTO holistic_mentorship_phase_plans (program_id, academic_year) VALUES ($1, $2) RETURNING id",
        [programId, academicYear]);
    });
  }, 20000);

  afterAll(async () => {
    if (!db) return;
    await db.default.end();
    delete (globalThis as { pool?: unknown }).pool;
  });

  it("creates Notes, freezes the Phase and keeps a Categories-only first draft", async () => {
    const phase = await seedPhase(1);
    const { studentId } = await seedMentee();
    const target = { studentId, ...phase };

    expect(await draft(target, { expectedRevision: 0, challengeCategories: [] }))
      .toEqual({ ok: true, changed: false, revision: 0 });
    expect(await phaseFrozen(phase.phaseId)).toBe(false);

    expect(await draft(target, { expectedRevision: 0, challengeCategories: ["non_academic.financial"] }))
      .toEqual({ ok: true, changed: true, revision: 1 });
    expect(await phaseFrozen(phase.phaseId)).toBe(true);
    expect(await mentorView(studentId, phase.phaseId)).toMatchObject({
      draftSaved: true,
      notesRevision: 1,
      notes: { state: "draft", answers: [], challengeCategories: ["non_academic.financial"] },
    });
  });

  it("leaves exactly the submitted Category set after each save", async () => {
    const phase = await seedPhase(2);
    const { studentId, mappingId } = await seedMentee();
    const target = { studentId, ...phase };
    const categories = async () => (await mentorView(studentId, phase.phaseId)).notes?.challengeCategories;

    await draft(target, { expectedRevision: 0, answer: "Exam nerves",
      challengeCategories: ["non_academic.financial", "academic.other", "non_academic.wellness"] });
    expect(await categories()).toEqual(["academic.other", "non_academic.wellness", "non_academic.financial"]);

    await draft(target, { expectedRevision: 1, answer: "Exam nerves",
      challengeCategories: ["non_academic.wellness", "academic.exam_related"] });
    expect(await categories()).toEqual(["academic.exam_related", "non_academic.wellness"]);

    await draft(target, { expectedRevision: 2, answer: "Exam nerves", challengeCategories: [] });
    expect(await categories()).toEqual([]);

    const [phaseRow] = await db.query<{ revision: number }>(
      "SELECT revision FROM holistic_mentorship_phases WHERE id = $1", [phase.phaseId]);
    const finalWrite = (mode: "submit" | "edit", expectedRevision: number, challengeCategories: string[]) => save({
      mode, studentId, phaseId: phase.phaseId, schoolId, programId, academicYear,
      actorUserId: firstMentorId, expectedRevision, expectedMappingId: mappingId,
      expectedPhaseRevision: phaseRow.revision, confirmed: true,
      answers: [{ questionId: phase.questionId, answer: "Exam nerves" }], challengeCategories,
    });

    expect(await finalWrite("submit", 3, ["academic.exam_related"])).toEqual({
      ok: false, status: 422, error: "Choose at least one Academic and one Non-academic Challenge Category",
    });
    expect(await categories()).toEqual([]);

    expect(await finalWrite("submit", 3, ["academic.exam_related", "non_academic.no_major_issue"]))
      .toEqual({ ok: true, changed: true, revision: 4 });
    expect(await mentorView(studentId, phase.phaseId)).toMatchObject({
      notes: { state: "submitted", challengeCategories: ["academic.exam_related", "non_academic.no_major_issue"] },
    });

    expect(await finalWrite("edit", 4, ["academic.subject_concept", "non_academic.adjustment"]))
      .toEqual({ ok: true, changed: true, revision: 5 });
    expect(await categories()).toEqual(["academic.subject_concept", "non_academic.adjustment"]);
  });

  it("lets a replacement Mentor claim a draft only after answers and Categories are erased", async () => {
    const phase = await seedPhase(3);
    const { studentId, mappingId } = await seedMentee();
    const target = { studentId, ...phase };
    await draft(target, { expectedRevision: 0, answer: "Previous Mentor's words",
      challengeCategories: ["academic.backlogs_workload"] });
    await replaceMentor(studentId, mappingId);
    // Answers alone gone (pre-#459 erasure): the Categories still make it content.
    await db.query("DELETE FROM holistic_mentorship_post_session_answers WHERE notes_id IN (SELECT id FROM holistic_mentorship_post_session_notes WHERE student_id = $1)", [studentId]);

    expect(await draft(target, { actorUserId: replacementMentorId, expectedRevision: 0,
      answer: "A fresh start", challengeCategories: [] })).toMatchObject({ ok: false, status: 409 });

    await db.withTransaction((client) => eraseDraft(client, [studentId], firstMentorId, "issue457 synthetic reassignment"));

    expect(await draft(target, { actorUserId: replacementMentorId, expectedRevision: 0,
      answer: "A fresh start", challengeCategories: ["academic.other"] })).toMatchObject({ ok: true, changed: true });
    expect(await mentorView(studentId, phase.phaseId, replacementMentorId)).toMatchObject({
      canEditNotes: true,
      notes: { state: "draft", challengeCategories: ["academic.other"],
        answers: [expect.objectContaining({ answer: "A fresh start" })] },
    });
  });
});
