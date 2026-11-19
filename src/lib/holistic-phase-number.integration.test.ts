// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { holisticPhaseNumberSql, withHolisticPhaseNumbers } from "./holistic-phase-number";

// Runs the SQL form of the Phase number rule on real Postgres and compares it with
// the JS form. Opt in with a migrated, disposable local DB; the rows it inserts are
// rolled back.
// HOLISTIC_PHASE_NUMBER_TEST_DATABASE=dbservice_test_lms516 DATABASE_HOST=localhost \
// DATABASE_USER=postgres DATABASE_PASSWORD=postgres \
// npx vitest run src/lib/holistic-phase-number.integration.test.ts
const database = process.env.HOLISTIC_PHASE_NUMBER_TEST_DATABASE;
let db: typeof import("./db");

class RollBack extends Error {}

describe.skipIf(!database)("Holistic Phase number SQL against disposable Postgres", () => {
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
  }, 20000);

  afterAll(async () => {
    if (!db) return;
    await db.default.end();
    delete (globalThis as { pool?: unknown }).pool;
  });

  it("numbers a Plan that mixes Grades the same way as the JS rule", async () => {
    // Plan order: Grade 12, 11, 11, 12, 11, 12, with gaps between positions.
    const planned = [[12, 1], [11, 2], [11, 3], [12, 5], [11, 8], [12, 9]];
    let rows: Array<{ grade: 11 | 12; position: number; number: number }> = [];

    await db.withTransaction(async (client) => {
      const plan = await client.query<{ id: string }>(
        `INSERT INTO holistic_mentorship_phase_plans (program_id, academic_year, inserted_at, updated_at)
         SELECT id, '1990-1991', now(), now() FROM program ORDER BY id LIMIT 1
         RETURNING id`
      );
      for (const [grade, position] of planned) {
        await client.query(
          `INSERT INTO holistic_mentorship_phases
             (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision, inserted_at, updated_at)
           SELECT $1, grade.id, 'Issue 516 integration', $3, 'locked', '', 1, now(), now()
           FROM grade WHERE grade.number = $2`,
          [plan.rows[0].id, grade, position]
        );
      }
      const numbered = await client.query<{ grade: number; position: number; number: number }>(
        `SELECT phase_grade.number AS grade, phase.position,
                ${holisticPhaseNumberSql("phase", "phase_grade.number")} AS number
         FROM holistic_mentorship_phases phase
         JOIN grade phase_grade ON phase_grade.id = phase.grade_id
         WHERE phase.phase_plan_id = $1
         ORDER BY phase.position`,
        [plan.rows[0].id]
      );
      rows = numbered.rows.map((row) => ({ ...row, grade: row.grade as 11 | 12 }));
      throw new RollBack();
    }).catch((error) => {
      if (!(error instanceof RollBack)) throw error;
    });

    expect(rows.map(({ grade, number }) => [grade, number])).toEqual([
      [12, 4], [11, 1], [11, 2], [12, 5], [11, 3], [12, 6],
    ]);
    expect(rows.map(({ number }) => number)).toEqual(
      withHolisticPhaseNumbers(rows.map(({ grade, position }) => ({ grade, position }))).map(({ number }) => number)
    );
  });
});
