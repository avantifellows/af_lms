// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { UserPermission } from "./permissions";

// Explicitly opt in with a migrated, disposable local DB that includes
// db-service #806 (post-session Challenge Category rows). Synthetic rows remain;
// drop the disposable DB to remove them.
// HOLISTIC_HEATMAP_TEST_DATABASE=dbservice_test_lms457 DATABASE_HOST=localhost \
// DATABASE_USER=postgres DATABASE_PASSWORD=postgres \
// npx vitest run src/lib/holistic-challenge-category-heatmap.integration.test.ts
const database = process.env.HOLISTIC_HEATMAP_TEST_DATABASE;
const academicYear = "2026-2027";
const runId = randomUUID();
const tag = runId.slice(0, 8);
let db: typeof import("./db");
let heatmap: typeof import("./holistic-challenge-category-heatmap").getHolisticChallengeCategoryHeatmap;
let programId: number;
let mentorId: number;
const phases: Record<"g11p1" | "g11p2" | "g12p1" | "g11p3", number> = { g11p1: 0, g11p2: 0, g12p1: 0, g11p3: 0 };
const schools: Record<"alpha" | "beta" | "charlie" | "delta", { id: number; code: string; name: string }> = {
  alpha: { id: 0, code: `R463A${tag}`, name: `Issue463 Alpha ${tag}` },
  beta: { id: 0, code: `R463B${tag}`, name: `Issue463 Beta ${tag}` },
  charlie: { id: 0, code: `R463C${tag}`, name: `Issue463 Charlie ${tag}` },
  delta: { id: 0, code: `R463D${tag}`, name: `Issue463 Delta ${tag}` },
};

const admin: UserPermission = { email: `issue463-${runId}@example.test`, level: 3, role: "admin" };
let programManager: UserPermission;

async function insertId(client: PoolClient, sql: string, params: unknown[] = []) {
  const result = await client.query<{ id: string | number }>(sql, params);
  return Number(result.rows[0].id);
}

async function seedStudent(client: PoolClient) {
  const userId = await insertId(client,
    'INSERT INTO "user" (inserted_at, updated_at) VALUES (now(), now()) RETURNING id');
  return insertId(client,
    "INSERT INTO student (user_id, inserted_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [userId]);
}

async function seedMapping(client: PoolClient, studentId: number, schoolId: number,
  startedAt: string, endedAt: string | null = null) {
  await client.query(
    `INSERT INTO holistic_mentorship_mentor_mentee_mappings
       (student_id, mentor_user_id, school_id, program_id, academic_year, started_at, assignment_source,
        ended_at, end_source, end_reason)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 'af_lms_teacher', $7::timestamptz,
             CASE WHEN $7::timestamptz IS NULL THEN NULL ELSE 'af_lms_admin' END,
             CASE WHEN $7::timestamptz IS NULL THEN NULL ELSE 'Synthetic transfer' END)`,
    [studentId, mentorId, schoolId, programId, academicYear, startedAt, endedAt]);
}

async function seedNotes(client: PoolClient, studentId: number, phaseId: number,
  state: "draft" | "submitted", categories: string[], answer?: string) {
  const notesId = await insertId(client,
    `INSERT INTO holistic_mentorship_post_session_notes
       (student_id, phase_id, author_user_id, state, revision,
        first_drafted_at, first_submitted_at, last_edited_at)
     VALUES ($1, $2, $3, $4::text, 1, now(), CASE WHEN $4::text = 'submitted' THEN now() END, now())
     RETURNING id`,
    [studentId, phaseId, mentorId, state]);
  if (answer) {
    await client.query(
      `INSERT INTO holistic_mentorship_post_session_answers (notes_id, question_id, answer)
       SELECT $1, question.id, $2 FROM holistic_mentorship_phase_questions question
       WHERE question.phase_id = $3 ORDER BY question.position LIMIT 1`, [notesId, answer, phaseId]);
  }
  for (const code of categories) {
    await client.query(
      `INSERT INTO holistic_mentorship_post_session_note_challenges (notes_id, category_code)
       VALUES ($1, $2)`, [notesId, code]);
  }
}

// Every code absent from `present` is a hand-written zero.
function counts(present: Record<string, number>) {
  return expect.objectContaining({
    "academic.subject_concept": 0,
    "academic.backlogs_workload": 0,
    "academic.exam_related": 0,
    "academic.test_preparation": 0,
    "academic.other": 0,
    "academic.no_major_issue": 0,
    "non_academic.time_management": 0,
    "non_academic.confidence_motivation": 0,
    "non_academic.adjustment": 0,
    "non_academic.wellness": 0,
    "non_academic.emotional_social": 0,
    "non_academic.career_uncertainty": 0,
    "non_academic.financial": 0,
    "non_academic.communication_language": 0,
    "non_academic.other": 0,
    "non_academic.no_major_issue": 0,
    ...present,
  });
}

function school(key: keyof typeof schools, studentCount: number, present: Record<string, number>) {
  return { code: schools[key].code, name: schools[key].name, studentCount, counts: counts(present) };
}

// Skipping does not import db.ts, construct a pool, or load application DB env.
describe.skipIf(!database)("Challenge Category Heatmap against disposable Postgres", () => {
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
    heatmap = (await import("./holistic-challenge-category-heatmap")).getHolisticChallengeCategoryHeatmap;
    const [connection] = await db.query<{ name: string; address: string }>(
      "SELECT current_database() AS name, host(inet_server_addr()) AS address");
    expect(connection.name).toBe(database);
    expect(["127.0.0.1", "::1"]).toContain(connection.address);
    await db.query("SELECT 1 FROM holistic_mentorship_post_session_note_challenges LIMIT 0");

    await db.withTransaction(async (client) => {
      mentorId = await insertId(client,
        'INSERT INTO "user" (inserted_at, updated_at) VALUES (now(), now()) RETURNING id');
      const productId = await insertId(client,
        "INSERT INTO product (name, inserted_at, updated_at) VALUES ('Issue463 synthetic', now(), now()) RETURNING id");
      programId = await insertId(client,
        "INSERT INTO program (name, product_id, inserted_at, updated_at) VALUES ('Issue463 synthetic', $1, now(), now()) RETURNING id", [productId]);
      const grade11 = await insertId(client,
        "INSERT INTO grade (number, inserted_at, updated_at) VALUES (11, now(), now()) RETURNING id");
      const grade12 = await insertId(client,
        "INSERT INTO grade (number, inserted_at, updated_at) VALUES (12, now(), now()) RETURNING id");
      for (const value of Object.values(schools)) {
        value.id = await insertId(client,
          "INSERT INTO school (name, code, inserted_at, updated_at) VALUES ($1, $2, now(), now()) RETURNING id",
          [value.name, value.code]);
      }
      const planId = await insertId(client,
        "INSERT INTO holistic_mentorship_phase_plans (program_id, academic_year) VALUES ($1, $2) RETURNING id",
        [programId, academicYear]);
      // Plan order: Grade 11 Phase 1, Grade 11 Phase 2, Grade 12 Phase 3, Grade 11 Phase 4 (locked).
      const phaseRows: [keyof typeof phases, number, number, string, "open" | "locked"][] = [
        ["g11p1", grade11, 1, "Settling in", "open"],
        ["g11p2", grade11, 2, "Mid-term check", "open"],
        ["g12p1", grade12, 3, "Board prep", "open"],
        ["g11p3", grade11, 4, "Year end", "locked"],
      ];
      for (const [key, gradeId, position, title, state] of phaseRows) {
        phases[key] = await insertId(client,
          `INSERT INTO holistic_mentorship_phases
             (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision)
           VALUES ($1, $2, $3, $4, $5, 'Synthetic guidance', 1) RETURNING id`,
          [planId, gradeId, title, position, state]);
        await client.query(
          "INSERT INTO holistic_mentorship_phase_questions (phase_id, text, position) VALUES ($1, 'Synthetic question', 1)",
          [phases[key]]);
      }

      // S1 at Alpha: overlapping and different codes across two Phases.
      const s1 = await seedStudent(client);
      await seedMapping(client, s1, schools.alpha.id, "2026-06-01");
      await seedNotes(client, s1, phases.g11p1, "submitted", ["academic.subject_concept", "non_academic.financial"]);
      await seedNotes(client, s1, phases.g11p2, "submitted", ["academic.subject_concept", "non_academic.time_management"]);
      // S2 at Alpha: No major issue reported in both groups.
      const s2 = await seedStudent(client);
      await seedMapping(client, s2, schools.alpha.id, "2026-06-01");
      await seedNotes(client, s2, phases.g11p1, "submitted", ["academic.no_major_issue", "non_academic.no_major_issue"]);
      // S3 at Alpha: a draft with Categories never counts.
      const s3 = await seedStudent(client);
      await seedMapping(client, s3, schools.alpha.id, "2026-06-01");
      await seedNotes(client, s3, phases.g11p1, "draft", ["academic.exam_related", "non_academic.wellness"]);
      // S4, Charlie's only Student: submitted but untagged, so Charlie has n = 0.
      const s4 = await seedStudent(client);
      await seedMapping(client, s4, schools.charlie.id, "2026-06-01");
      await seedNotes(client, s4, phases.g11p1, "submitted", [], "Synthetic pre-release answer");
      // S5 moved Alpha -> Beta mid-year: counts under Beta only.
      const s5 = await seedStudent(client);
      await seedMapping(client, s5, schools.alpha.id, "2026-06-01", "2026-08-01");
      await seedMapping(client, s5, schools.beta.id, "2026-08-01");
      await seedNotes(client, s5, phases.g11p1, "submitted", ["academic.exam_related", "non_academic.career_uncertainty"]);
      // S6 at Beta: only an ended Mapping, still counted.
      const s6 = await seedStudent(client);
      await seedMapping(client, s6, schools.beta.id, "2026-06-01", "2026-09-01");
      await seedNotes(client, s6, phases.g11p2, "submitted", ["academic.subject_concept", "non_academic.financial"]);
      // S7 moved Beta -> Delta: Delta for program-wide readers, Beta for a PM without Delta.
      const s7 = await seedStudent(client);
      await seedMapping(client, s7, schools.beta.id, "2026-06-01", "2026-09-01");
      await seedMapping(client, s7, schools.delta.id, "2026-09-01");
      await seedNotes(client, s7, phases.g11p1, "submitted", ["academic.other", "non_academic.other"]);
      // S8 at Alpha: Grade 12 Notes never reach a Grade 11 heatmap.
      const s8 = await seedStudent(client);
      await seedMapping(client, s8, schools.alpha.id, "2026-06-01");
      await seedNotes(client, s8, phases.g12p1, "submitted", ["academic.exam_related", "non_academic.wellness"]);
    });
    programManager = {
      email: `issue463-pm-${runId}@example.test`,
      level: 1,
      role: "program_manager",
      school_codes: [schools.alpha.code, schools.beta.code, schools.charlie.code],
      program_ids: [programId],
    };
  }, 20000);

  afterAll(async () => {
    if (!db) return;
    await db.default.end();
    delete (globalThis as { pool?: unknown }).pool;
  });

  it("counts each Student once per Category across All Phases under their latest School", async () => {
    const result = await heatmap({ programId, academicYear, grade: 11, phaseId: null }, admin);

    // Alpha: S1, S2 (S3 has only a draft; S5 moved to Beta). n = 2.
    // Beta: S5 (moved in), S6 (ended Mapping). n = 2. Delta: S7. n = 1.
    // Charlie: S4 is untagged, so n = 0 and the School is hidden.
    expect(result).toMatchObject({
      programIds: [programId],
      academicYear,
      grade: 11,
      phaseId: null,
      total: {
        studentCount: 5,
        counts: counts({
          "academic.subject_concept": 2,
          "academic.exam_related": 1,
          "academic.other": 1,
          "academic.no_major_issue": 1,
          "non_academic.time_management": 1,
          "non_academic.career_uncertainty": 1,
          "non_academic.financial": 2,
          "non_academic.other": 1,
          "non_academic.no_major_issue": 1,
        }),
      },
      schools: [
        school("alpha", 2, {
          "academic.subject_concept": 1,
          "academic.no_major_issue": 1,
          "non_academic.time_management": 1,
          "non_academic.financial": 1,
          "non_academic.no_major_issue": 1,
        }),
        school("beta", 2, {
          "academic.subject_concept": 1,
          "academic.exam_related": 1,
          "non_academic.career_uncertainty": 1,
          "non_academic.financial": 1,
        }),
        school("delta", 1, { "academic.other": 1, "non_academic.other": 1 }),
      ],
      hiddenSchoolCount: 1,
    });
  });
  it("counts only the selected Phase's Notes when one Phase is chosen", async () => {
    const result = await heatmap({ programId, academicYear, grade: 11, phaseId: phases.g11p2 }, admin);

    // Phase 2 Notes: S1 (Alpha) and S6 (Beta). Charlie and Delta have Mappings but n = 0.
    expect(result).toMatchObject({
      phaseId: phases.g11p2,
      total: {
        studentCount: 2,
        counts: counts({
          "academic.subject_concept": 2,
          "non_academic.time_management": 1,
          "non_academic.financial": 1,
        }),
      },
      schools: [
        school("alpha", 1, { "academic.subject_concept": 1, "non_academic.time_management": 1 }),
        school("beta", 1, { "academic.subject_concept": 1, "non_academic.financial": 1 }),
      ],
      hiddenSchoolCount: 2,
    });
  });

  it("attributes a PM's out-of-scope transfer to the in-scope School and omits out-of-scope Schools", async () => {
    const result = await heatmap({ programId, academicYear, grade: 11, phaseId: null }, programManager);

    // S7's latest Mapping is Delta, outside the PM's Schools, so Beta keeps S7.
    expect(result).toMatchObject({
      total: {
        studentCount: 5,
        counts: counts({
          "academic.subject_concept": 2,
          "academic.exam_related": 1,
          "academic.other": 1,
          "academic.no_major_issue": 1,
          "non_academic.time_management": 1,
          "non_academic.career_uncertainty": 1,
          "non_academic.financial": 2,
          "non_academic.other": 1,
          "non_academic.no_major_issue": 1,
        }),
      },
      schools: [
        school("alpha", 2, {
          "academic.subject_concept": 1,
          "academic.no_major_issue": 1,
          "non_academic.time_management": 1,
          "non_academic.financial": 1,
          "non_academic.no_major_issue": 1,
        }),
        school("beta", 3, {
          "academic.subject_concept": 1,
          "academic.exam_related": 1,
          "academic.other": 1,
          "non_academic.career_uncertainty": 1,
          "non_academic.financial": 1,
          "non_academic.other": 1,
        }),
      ],
      hiddenSchoolCount: 1,
    });
  });
  it("lists the Grade's Phases in Plan order and defaults to its latest Open Phase", async () => {
    const grade11 = await heatmap({ programId, academicYear, grade: 11, phaseId: null }, admin);
    const grade12 = await heatmap({ programId, academicYear, grade: 12, phaseId: null }, admin);

    expect(grade11).toMatchObject({
      phases: [
        { id: phases.g11p1, number: 1, title: "Settling in", state: "open" },
        { id: phases.g11p2, number: 2, title: "Mid-term check", state: "open" },
        { id: phases.g11p3, number: 4, title: "Year end", state: "locked" },
      ],
      defaultPhaseId: phases.g11p2,
      academicYears: [academicYear],
    });
    expect(grade12).toMatchObject({
      phases: [{ id: phases.g12p1, number: 3, title: "Board prep", state: "open" }],
      defaultPhaseId: phases.g12p1,
      total: {
        studentCount: 1,
        counts: counts({ "academic.exam_related": 1, "non_academic.wellness": 1 }),
      },
      schools: [school("alpha", 1, { "academic.exam_related": 1, "non_academic.wellness": 1 })],
      hiddenSchoolCount: 3,
    });
  });

  it("defaults to All Phases when the Grade has no Open Phase", async () => {
    const result = await heatmap({ programId, academicYear: "2025-2026", grade: 11, phaseId: null }, admin);

    expect(result).toMatchObject({ phases: [], defaultPhaseId: null, total: { studentCount: 0 }, schools: [] });
  });

  it("rejects a Phase outside the Program's Plan for that year and Grade", async () => {
    expect(await heatmap({ programId, academicYear, grade: 11, phaseId: phases.g12p1 }, admin)).toBeNull();
    expect(await heatmap({ programId, academicYear: "2025-2026", grade: 11, phaseId: phases.g11p1 }, admin))
      .toBeNull();
  });
});
