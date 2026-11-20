// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CURRENT_ACADEMIC_YEAR } from "./constants";

// Issue #536: only the Active Phase of a Grade takes Mentor writes. Runs against
// real Postgres because the rule rests on row locks and statement snapshots.
// Explicitly opt in with a migrated, disposable local DB. Synthetic rows remain;
// drop the disposable DB to remove them.
// HOLISTIC_NOTES_TEST_DATABASE=dbservice_test_lms536 DATABASE_HOST=localhost \
// DATABASE_USER=postgres DATABASE_PASSWORD=postgres \
// npx vitest run src/lib/holistic-closed-phases.integration.test.ts
const database = process.env.HOLISTIC_NOTES_TEST_DATABASE;
const academicYear = "2026-2027";
const runId = randomUUID();
const CLOSED = "This Phase is closed. Notes can be added or changed only in the Active Phase.";
const CATEGORIES = ["academic.exam_related", "non_academic.time_management"];

let db: typeof import("./db");
let save: typeof import("./holistic-notes").saveHolisticNotes;
let addFollowUp: typeof import("./holistic-follow-up-notes").addHolisticFollowUpNote;
let readStudentPhase: typeof import("./holistic-student-phase").getHolisticStudentPhase;
let setPhaseState: typeof import("./holistic-phase-plans").setHolisticPhaseState;
let openImpact: typeof import("./holistic-phase-plans").getHolisticPhaseOpenImpact;
let reorder: typeof import("./holistic-phase-plans").reorderHolisticPhases;
let mentorId: number;
let schoolId: number;
let grade11Id: number;
let grade12Id: number;

type Phase = { phaseId: number; questionId: number };
type Mentee = { studentId: number; mappingId: number };
type Program = { programId: number; planId: number; schoolGroupId: number; batchGroupId: number };

async function insertId(client: PoolClient, sql: string, params: unknown[] = []) {
  const result = await client.query<{ id: string | number }>(sql, params);
  return Number(result.rows[0].id);
}

// Each test gets its own Program and Plan, so Phases never leak between tests.
async function seedProgram(): Promise<Program> {
  return db.withTransaction(async (client) => {
    const productId = await insertId(client,
      "INSERT INTO product (name, inserted_at, updated_at) VALUES ('Issue536 synthetic', now(), now()) RETURNING id");
    const programId = await insertId(client,
      "INSERT INTO program (name, product_id, inserted_at, updated_at) VALUES ('Issue536 synthetic', $1, now(), now()) RETURNING id", [productId]);
    const schoolGroupId = await insertId(client,
      `INSERT INTO "group" (type, child_id, inserted_at, updated_at)
       VALUES ('school', $1, now(), now()) RETURNING id`, [schoolId]);
    const batchId = await insertId(client,
      `INSERT INTO batch (name, program_id, inserted_at, updated_at)
       VALUES ('Issue536 synthetic', $1, now(), now()) RETURNING id`, [programId]);
    const batchGroupId = await insertId(client,
      `INSERT INTO "group" (type, child_id, inserted_at, updated_at)
       VALUES ('batch', $1, now(), now()) RETURNING id`, [batchId]);
    await client.query(
      `INSERT INTO centres (name, school_id, program_id, is_physical, is_active)
       VALUES ('Issue536 synthetic', $1, $2, true, true)`, [schoolId, programId]);
    const planId = await insertId(client,
      "INSERT INTO holistic_mentorship_phase_plans (program_id, academic_year) VALUES ($1, $2) RETURNING id",
      [programId, academicYear]);
    return { programId, planId, schoolGroupId, batchGroupId };
  });
}

async function seedPhase(
  program: Program,
  position: number,
  options: { state?: "open" | "locked"; gradeId?: number } = {}
): Promise<Phase> {
  return db.withTransaction(async (client) => {
    const phaseId = await insertId(client,
      `INSERT INTO holistic_mentorship_phases
         (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision)
       VALUES ($1, $2, $3, $4, $5, 'Synthetic guidance', 1) RETURNING id`,
      [program.planId, options.gradeId ?? grade11Id, `Synthetic phase ${position}`, position,
        options.state ?? "open"]);
    const questionId = await insertId(client,
      `INSERT INTO holistic_mentorship_phase_questions (phase_id, text, position)
       VALUES ($1, 'Describe the academic challenges the student shared', 1) RETURNING id`, [phaseId]);
    return { phaseId, questionId };
  });
}

// A current Grade 11 roster Student mapped to the Mentor.
async function seedMentee(program: Program): Promise<Mentee> {
  return db.withTransaction(async (client) => {
    const userId = await insertId(client,
      `INSERT INTO "user" (first_name, inserted_at, updated_at)
       VALUES ('Issue536 synthetic', now(), now()) RETURNING id`);
    const studentId = await insertId(client,
      "INSERT INTO student (user_id, inserted_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [userId]);
    for (const groupId of [program.schoolGroupId, program.batchGroupId]) {
      await client.query("INSERT INTO group_user (user_id, group_id) VALUES ($1, $2)", [userId, groupId]);
    }
    await client.query(
      `INSERT INTO enrollment_record
         (user_id, group_type, group_id, academic_year, is_current, inserted_at, updated_at)
       VALUES ($1, 'grade', $2, $3, true, now(), now())`, [userId, grade11Id, academicYear]);
    const mappingId = await insertId(client,
      `INSERT INTO holistic_mentorship_mentor_mentee_mappings
         (student_id, mentor_user_id, school_id, program_id, academic_year, started_at, assignment_source)
       VALUES ($1, $2, $3, $4, $5, now() - interval '1 day', 'issue536_test') RETURNING id`,
      [studentId, mentorId, schoolId, program.programId, academicYear]);
    return { studentId, mappingId };
  });
}

function target(program: Program, mentee: Mentee, phase: Phase) {
  return {
    studentId: mentee.studentId, phaseId: phase.phaseId, schoolId, programId: program.programId,
    academicYear, actorUserId: mentorId,
  };
}

function draft(program: Program, mentee: Mentee, phase: Phase, expectedRevision: number, answer: string) {
  return save({
    ...target(program, mentee, phase), mode: "draft", expectedRevision,
    answers: [{ questionId: phase.questionId, answer }], challengeCategories: CATEGORIES,
  });
}

function finalWrite(
  program: Program, mentee: Mentee, phase: Phase,
  mode: "submit" | "edit", expectedRevision: number, answer: string, expectedPhaseRevision = 1
) {
  return save({
    ...target(program, mentee, phase), mode, expectedRevision,
    expectedMappingId: mentee.mappingId, expectedPhaseRevision, confirmed: true,
    answers: [{ questionId: phase.questionId, answer }], challengeCategories: CATEGORIES,
  });
}

function followUp(program: Program, mentee: Mentee, phase: Phase) {
  return addFollowUp({
    ...target(program, mentee, phase), actorEmail: "issue536-mentor@example.test",
    answers: { challenges: "Exam stress", solutions: null, action_plan: null },
  });
}

async function mentorView(program: Program, mentee: Mentee, phase: Phase) {
  const detail = await readStudentPhase({
    ...target(program, mentee, phase), role: "teacher", canEdit: true,
  });
  return detail!;
}

async function notesRows(mentee: Mentee, phase: Phase) {
  return db.query<{ state: string; revision: number; answer: string | null }>(
    `SELECT notes.state, notes.revision,
            (SELECT answer.answer FROM holistic_mentorship_post_session_answers answer
             WHERE answer.notes_id = notes.id LIMIT 1) AS answer
     FROM holistic_mentorship_post_session_notes notes
     WHERE notes.student_id = $1 AND notes.phase_id = $2`, [mentee.studentId, phase.phaseId]);
}

async function followUpCount(mentee: Mentee, phase: Phase) {
  const [row] = await db.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM holistic_mentorship_follow_up_notes WHERE student_id = $1 AND phase_id = $2",
    [mentee.studentId, phase.phaseId]);
  return Number(row.count);
}

function changeState(
  program: Program, phase: Phase, state: "open" | "locked", expectedRevision = 1,
  expectedClosing?: { expectedClosingPhaseId: number | null }
) {
  return setPhaseState({
    programId: program.programId, phaseId: phase.phaseId, expectedRevision, state,
    confirmed: true, actorEmail: "issue536-admin@example.test", ...expectedClosing,
  });
}

// Skipping does not import db.ts, construct a pool, or load application DB env.
describe.skipIf(!database)("Closed Holistic Phases against disposable Postgres (#536)", () => {
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
    addFollowUp = (await import("./holistic-follow-up-notes")).addHolisticFollowUpNote;
    readStudentPhase = (await import("./holistic-student-phase")).getHolisticStudentPhase;
    const plans = await import("./holistic-phase-plans");
    setPhaseState = plans.setHolisticPhaseState;
    openImpact = plans.getHolisticPhaseOpenImpact;
    reorder = plans.reorderHolisticPhases;
    const [connection] = await db.query<{ name: string; address: string }>(
      "SELECT current_database() AS name, host(inet_server_addr()) AS address");
    expect(connection.name).toBe(database);
    expect(["127.0.0.1", "::1"]).toContain(connection.address);
    await db.query("SELECT 1 FROM holistic_mentorship_follow_up_notes LIMIT 0");

    await db.withTransaction(async (client) => {
      mentorId = await insertId(client,
        `INSERT INTO "user" (first_name, email, inserted_at, updated_at)
         VALUES ('Issue536 mentor', $1, now(), now()) RETURNING id`, [`issue536-mentor-${runId}@example.test`]);
      grade11Id = await insertId(client,
        "INSERT INTO grade (number, inserted_at, updated_at) VALUES (11, now(), now()) RETURNING id");
      grade12Id = await insertId(client,
        "INSERT INTO grade (number, inserted_at, updated_at) VALUES (12, now(), now()) RETURNING id");
      schoolId = await insertId(client,
        "INSERT INTO school (name, inserted_at, updated_at) VALUES ('Issue536 synthetic', now(), now()) RETURNING id");
    });
  }, 20000);

  afterAll(async () => {
    if (!db) return;
    await db.default.end();
    delete (globalThis as { pool?: unknown }).pool;
  });

  it("makes an earlier Phase read-only the moment a later Phase of the Grade opens", async () => {
    const program = await seedProgram();
    const phase1 = await seedPhase(program, 1);
    const phase3 = await seedPhase(program, 3, { state: "locked" });
    const done = await seedMentee(program);     // submitted Notes in Phase 1
    const drafting = await seedMentee(program); // a saved draft in Phase 1
    const pending = await seedMentee(program);  // nothing in Phase 1

    expect(await draft(program, done, phase1, 0, "Settling in")).toMatchObject({ ok: true, revision: 1 });
    expect(await finalWrite(program, done, phase1, "submit", 1, "Settling in")).toMatchObject({ ok: true, revision: 2 });
    expect(await followUp(program, done, phase1)).toMatchObject({ ok: true });
    expect(await draft(program, drafting, phase1, 0, "Half written")).toMatchObject({ ok: true, revision: 1 });

    expect(await changeState(program, phase3, "open")).toMatchObject({ ok: true });

    // Every write to Phase 1 is refused by the API layer, for every Mentee.
    const closed = { ok: false, status: 422, error: CLOSED };
    expect(await finalWrite(program, done, phase1, "edit", 2, "Changed after closing")).toEqual(closed);
    expect(await followUp(program, done, phase1)).toEqual(closed);
    expect(await draft(program, drafting, phase1, 1, "More typing")).toEqual(closed);
    expect(await finalWrite(program, drafting, phase1, "submit", 1, "Half written")).toEqual(closed);
    expect(await draft(program, pending, phase1, 0, "Late first notes")).toEqual(closed);

    // Nothing stored moved.
    expect(await notesRows(done, phase1)).toEqual([{ state: "submitted", revision: 2, answer: "Settling in" }]);
    expect(await followUpCount(done, phase1)).toBe(1);
    expect(await notesRows(drafting, phase1)).toEqual([{ state: "draft", revision: 1, answer: "Half written" }]);
    expect(await notesRows(pending, phase1)).toEqual([]);

    // Phase 1 stays readable: Closed, not editable, Notes and Follow-up Notes shown.
    const closedView = await mentorView(program, done, phase1);
    expect(closedView.selectedPhase).toMatchObject({
      locked: false, active: false, closed: true, canEditNotes: false, progress: "completed",
      notes: { state: "submitted", answers: [{ answer: "Settling in" }] },
    });
    expect((closedView.selectedPhase as { followUpNotes: unknown[] }).followUpNotes).toHaveLength(1);
    expect(closedView.phases).toMatchObject([
      { phaseId: phase1.phaseId, closed: true, active: false },
      { phaseId: phase3.phaseId, closed: false, active: true },
    ]);
    // The author still reads the unsubmitted draft, read-only.
    expect((await mentorView(program, drafting, phase1)).selectedPhase).toMatchObject({
      closed: true, canEditNotes: false, draftSaved: true,
      notes: { state: "draft", answers: [{ answer: "Half written" }] },
    });

    // The Active Phase works as before.
    expect((await mentorView(program, pending, phase3)).selectedPhase)
      .toMatchObject({ active: true, closed: false, canEditNotes: true });
    expect(await draft(program, pending, phase3, 0, "New quarter")).toMatchObject({ ok: true, revision: 1 });
    // Opening Phase 3 moved its revision to 2.
    expect(await finalWrite(program, pending, phase3, "submit", 1, "New quarter", 2)).toMatchObject({ ok: true });
    expect(await finalWrite(program, pending, phase3, "edit", 2, "New quarter, corrected", 2)).toMatchObject({ ok: true });
    expect(await followUp(program, pending, phase3)).toMatchObject({ ok: true });
  });

  it("does not close another Grade's Phase", async () => {
    const program = await seedProgram();
    const grade11Phase = await seedPhase(program, 1);
    const grade12Phase = await seedPhase(program, 2, { state: "locked", gradeId: grade12Id });
    const mentee = await seedMentee(program);

    expect(await changeState(program, grade12Phase, "open")).toMatchObject({ ok: true });

    expect((await mentorView(program, mentee, grade11Phase)).selectedPhase)
      .toMatchObject({ active: true, closed: false, canEditNotes: true });
    expect(await draft(program, mentee, grade11Phase, 0, "Grade 11 notes")).toMatchObject({ ok: true, revision: 1 });
  });

  it("makes the earlier Phase writable again when the unused later Phase returns to Locked", async () => {
    const program = await seedProgram();
    const phase1 = await seedPhase(program, 1);
    const phase3 = await seedPhase(program, 3, { state: "locked" });
    const mentee = await seedMentee(program);

    expect(await changeState(program, phase3, "open")).toMatchObject({ ok: true, revision: 2 });
    expect(await draft(program, mentee, phase1, 0, "Too late")).toMatchObject({ ok: false, error: CLOSED });

    expect(await changeState(program, phase3, "locked", 2)).toMatchObject({ ok: true });

    expect((await mentorView(program, mentee, phase1)).selectedPhase)
      .toMatchObject({ active: true, closed: false, canEditNotes: true });
    expect(await draft(program, mentee, phase1, 0, "Back in time")).toMatchObject({ ok: true, revision: 1 });
  });

  it("refuses to open a Phase ordered before the Grade's Open Phase", async () => {
    const program = await seedProgram();
    const phase1 = await seedPhase(program, 1, { state: "locked" });
    await seedPhase(program, 2, { gradeId: grade12Id }); // another Grade's Open Phase does not block
    await seedPhase(program, 3);

    expect(await changeState(program, phase1, "open")).toEqual({
      ok: false, status: 422,
      error: "This Phase cannot be opened while Phase 3, a later Phase for this Grade, is Open",
    });
    const [row] = await db.query<{ state: string }>(
      "SELECT state FROM holistic_mentorship_phases WHERE id = $1", [phase1.phaseId]);
    expect(row.state).toBe("locked");
  });

  it("tells the Admin how many Mentees the closing Phase leaves without Notes", async () => {
    const program = await seedProgram();
    const phase1 = await seedPhase(program, 1);
    const phase3 = await seedPhase(program, 3, { state: "locked" });
    const done = await seedMentee(program);
    const drafting = await seedMentee(program);
    await seedMentee(program); // no Notes at all
    const ended = await seedMentee(program); // Mapping ended: not counted
    await db.query(
      `UPDATE holistic_mentorship_mentor_mentee_mappings
       SET ended_at = now(), end_source = 'issue536_test', end_reason = 'removed' WHERE id = $1`,
      [ended.mappingId]);

    expect(await draft(program, done, phase1, 0, "Done")).toMatchObject({ ok: true });
    expect(await finalWrite(program, done, phase1, "submit", 1, "Done")).toMatchObject({ ok: true });
    expect(await draft(program, drafting, phase1, 0, "Not yet")).toMatchObject({ ok: true });

    expect(await openImpact(program.programId, phase3.phaseId)).toEqual({
      closing: { id: phase1.phaseId, number: 1, menteesWithoutNotes: 2, unsubmittedDrafts: 1 },
    });
    // Not a Locked Phase of this Program: nothing to report.
    expect(await openImpact(program.programId, phase1.phaseId)).toBeNull();
    expect(await openImpact(program.programId + 1000000, phase3.phaseId)).toBeNull();
  });

  // Both tests below pause the real Admin function mid-transaction by holding one
  // Phase row from a third connection, and wait on what Postgres reports rather
  // than on a timer.
  async function lockWaiters() {
    const [row] = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`);
    return Number(row.count);
  }
  async function waitForLockWaiters(expected: number) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await lockWaiters() === expected) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Expected ${expected} sessions waiting on a lock, found ${await lockWaiters()}`);
  }
  async function holdingPhaseRow<T>(phase: Phase, during: (release: () => Promise<void>) => Promise<T>) {
    const blocker = await db.default.connect();
    let held = true;
    const release = async () => {
      if (!held) return;
      held = false;
      await blocker.query("ROLLBACK");
    };
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM holistic_mentorship_phases WHERE id = $1 FOR UPDATE", [phase.phaseId]);
      return await during(release);
    } finally {
      await release();
      blocker.release();
    }
  }

  it("refuses a write that was waiting while an Admin opened the next Phase", async () => {
    const program = await seedProgram();
    const phase1 = await seedPhase(program, 1);
    const phase3 = await seedPhase(program, 3, { state: "locked" });
    const mentee = await seedMentee(program);

    const [opened, write] = await holdingPhaseRow(phase3, async (release) => {
      // The real state change: it takes the Plan row, then stops at the held Phase row.
      const opening = changeState(program, phase3, "open");
      await waitForLockWaiters(1);
      // The Mentor saves into Phase 1 while the Admin's transaction is open.
      const saving = draft(program, mentee, phase1, 0, "Written during the switch");
      await waitForLockWaiters(2); // the save is waiting on the Plan row
      await release();
      return Promise.all([opening, saving]);
    });

    expect(opened).toMatchObject({ ok: true });
    expect(write).toEqual({ ok: false, status: 422, error: CLOSED });
    expect(await notesRows(mentee, phase1)).toEqual([]);
  });

  it("refuses an open when another Admin changed the Phase that would close after the first was asked to confirm", async () => {
    const program = await seedProgram();
    const phase1 = await seedPhase(program, 1);
    const phase2 = await seedPhase(program, 2, { state: "locked" });
    const phase3 = await seedPhase(program, 3, { state: "locked" });

    // Admin A is shown "Phase 1 will close" for opening Phase 3.
    const shown = await openImpact(program.programId, phase3.phaseId);
    expect(shown?.closing?.id).toBe(phase1.phaseId);
    // Admin B opens Phase 2 before A confirms.
    expect(await changeState(program, phase2, "open")).toMatchObject({ ok: true });

    // A's confirmed open would now close Phase 2, which A was never told about.
    const stale = await changeState(program, phase3, "open", 1, { expectedClosingPhaseId: shown!.closing!.id });
    expect(stale).toMatchObject({ ok: false, status: 409 });
    const [row] = await db.query<{ state: string; revision: number }>(
      "SELECT state, revision FROM holistic_mentorship_phases WHERE id = $1", [phase3.phaseId]);
    expect(row).toEqual({ state: "locked", revision: 1 });

    // Asked again, A is shown Phase 2 and the open goes through.
    const again = await openImpact(program.programId, phase3.phaseId);
    expect(again?.closing?.id).toBe(phase2.phaseId);
    expect(await changeState(program, phase3, "open", 1, { expectedClosingPhaseId: again!.closing!.id }))
      .toMatchObject({ ok: true });
  });

  it("does not deadlock a Mentor save with an Admin reordering Phases", async () => {
    const program = await seedProgram();
    // The reorder locks the Plan row, then every Phase row in order: it stops at
    // the held first row while the Mentor's Active Phase row is still free.
    const first = await seedPhase(program, 1, { state: "locked", gradeId: grade12Id });
    const active = await seedPhase(program, 2);
    const last = await seedPhase(program, 3, { state: "locked" });
    const mentee = await seedMentee(program);

    const [reordered, write] = await holdingPhaseRow(first, async (release) => {
      const reordering = reorder({
        programId: program.programId, academicYear: CURRENT_ACADEMIC_YEAR, actorEmail: "issue536-admin@example.test",
        // A real change of order: the two Locked Phases swap around the Open one.
        phases: [last, active, first].map((phase) => ({ id: phase.phaseId, expectedRevision: 1 })),
      });
      await waitForLockWaiters(1);
      // With the Phase row locked before the Plan row, this save would hold the
      // Active Phase and wait for the Plan, and the reorder would then wait for
      // that Phase: a deadlock, and a 500 for one of them.
      const saving = draft(program, mentee, active, 0, "Saved during a reorder");
      await waitForLockWaiters(2);
      await release();
      return Promise.all([reordering, saving]);
    });

    expect(reordered).toMatchObject({ ok: true });
    expect(write).toMatchObject({ ok: true, revision: 1 });
    const order = await db.query<{ id: string | number }>(
      "SELECT id FROM holistic_mentorship_phases WHERE phase_plan_id = $1 ORDER BY position", [program.planId]);
    expect(order.map((row) => Number(row.id))).toEqual([last.phaseId, active.phaseId, first.phaseId]);
  });
});
