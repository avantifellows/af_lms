import { describe, expect, it } from "vitest";

import {
  buildHolisticProfileSourceEvidence,
  buildHolisticProfileSourceQuery,
  runHolisticReleasePreflight,
} from "./holistic-release";
import {
  applyHolisticDbServiceSchema,
  HOLISTIC_FIXTURE_MANIFEST,
  seedHolisticFixtures,
} from "./holistic-fixtures";

describe("Holistic release preflight", () => {
  it("builds the approved Form query without exposing the Form registry", () => {
    const sourceQuery = buildHolisticProfileSourceQuery("avantifellows", "assessments");

    expect(sourceQuery.query).toContain("`avantifellows.assessments.all_responses_form_level`");
    expect(sourceQuery.params).toEqual({
      grade11Form: "6a44a83d1184e717b920c499",
      grade11Session: "EnableStudents_6a44a83d1184e717b920c499",
      grade12Form: "6a4deca8e030ebe34669fb0f",
      grade12Session: "EnableStudents_6a4deca8e030ebe34669fb0f",
    });
    expect(() => buildHolisticProfileSourceQuery("bad.project", "assessments"))
      .toThrow("Invalid BigQuery project or dataset");
  });

  it("blocks unsafe identity and form evidence without writing while Profile gaps remain non-blocking", async () => {
    const calls: string[] = [];
    const db = async (sql: string) => {
      calls.push(sql);
      if (sql.includes("preflight_program_schools")) return [{ school_id: 10 }];
      if (sql.includes("preflight_roster")) {
        return [
          { student_id: 101, user_id: "1001", grade: 11, has_profile: true },
          { student_id: 102, user_id: "1002", grade: 12, has_profile: false },
        ];
      }
      if (sql.includes("preflight_actors")) {
        return [
          { actor_class: "teacher", actor_count: 1 },
          { actor_class: "holistic_admin", actor_count: 1 },
          { actor_class: "global_admin", actor_count: 1 },
        ];
      }
      if (sql.includes("preflight_identity")) {
        return [
          { source_user_id: "1001", student_id: 101, eligible: true },
          { source_user_id: "1002", student_id: 102, eligible: true },
          { source_user_id: "duplicate", student_id: 201, eligible: true },
          { source_user_id: "duplicate", student_id: 202, eligible: true },
        ];
      }
      if (sql.includes("preflight_historical")) {
        return [{ safe_candidates: 42, excluded_rows: 11 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    };

    const questions = Array.from({ length: 34 }, (_, index) => ({
      questionId: `q${index + 1}`,
      position: index + 2,
      questionSetTitle: `Set ${Math.min(Math.floor(index / 7) + 1, 5)}`,
    }));
    const result = await runHolisticReleasePreflight({
      db,
      academicYear: "2026-2027",
      profileSource: {
        forms: [
          {
            grade: 11,
            formId: "6a44a83d1184e717b920c499",
            sessionId: "EnableStudents_6a44a83d1184e717b920c499",
            questions,
          },
          {
            grade: 12,
            formId: "6a4deca8e030ebe34669fb0f",
            sessionId: "EnableStudents_6a4deca8e030ebe34669fb0f",
            questions: questions.slice(0, 33),
          },
        ],
        sourceUserIds: ["1001", "1002", "missing", "duplicate"],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toEqual([
      "Approved Grade 11 Profile Form structure is invalid",
      "Approved Grade 12 Profile Form structure is invalid",
      "1 BigQuery User identity is missing from LMS",
      "1 BigQuery User identity is ambiguous in LMS",
    ]);
    expect(result.counts).toMatchObject({
      programSchools: 1,
      eligibleStudents: 2,
      grade11Students: 1,
      grade12Students: 1,
      eligibleTeachers: 1,
      holisticAdmins: 1,
      globalAdmins: 1,
      incompleteProfiles: 1,
      historicalCandidates: 42,
      excludedHistoricalRows: 11,
    });
    expect(result.warnings).toEqual(["1 eligible Student has no successful Active-configuration Profile"]);
    expect(calls.every((sql) => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?(?:WITH\b|SELECT\b)/i.test(sql))).toBe(true);
    expect(calls.every((sql) => !/\b(?:insert|update|delete|alter|drop|create)\b/i.test(sql))).toBe(true);
    expect(calls.find((sql) => sql.includes("preflight_historical"))).toContain("COUNT(DISTINCT student.id)");
  });

  it("uses db-service migrations and declares the complete synthetic local fixture", () => {
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    applyHolisticDbServiceSchema({
      dbServicePath: "/work/db-service",
      databaseUrl: "ecto://postgres:postgres@localhost/af_lms_test",
      run(command, args, options) {
        calls.push({ command, args, cwd: options.cwd });
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "mix",
      args: ["run", "--no-start", "-e", expect.stringContaining("Ecto.Migrator.up")],
      cwd: "/work/db-service",
    });
    expect(HOLISTIC_FIXTURE_MANIFEST).toEqual({
      academicYear: "2026-2027",
      grades: [11, 12],
      actorClasses: [
        "teacher",
        "former_mentor",
        "holistic_mentorship_admin",
        "admin",
        "program_manager",
        "program_admin",
        "passcode",
      ],
      states: ["locked", "open", "active", "skipped", "pending", "completed"],
      content: ["mapping", "profile", "historical_notes", "draft_notes", "submitted_notes"],
      syntheticOnly: true,
    });
  });

  it("normalizes only approved BigQuery Form and Session rows", () => {
    const rows = [
      {
        user_id: "1002",
        test_id: "6a4deca8e030ebe34669fb0f",
        session_id: "EnableStudents_6a4deca8e030ebe34669fb0f",
        question_id: "g12-q1",
        question_position_index: 1,
        question_set_title: "Background",
      },
      {
        user_id: "1001",
        test_id: "6a44a83d1184e717b920c499",
        session_id: "EnableStudents_6a44a83d1184e717b920c499",
        question_id: "g11-q1",
        question_position_index: 1,
        question_set_title: "Background",
      },
      {
        user_id: "excluded",
        test_id: "6a4f2714271be5caf8cf4ccd",
        session_id: "excluded-baseline",
        question_id: "q1",
        question_position_index: 1,
        question_set_title: "Excluded",
      },
    ];

    expect(buildHolisticProfileSourceEvidence(rows, ["H-1"])).toEqual({
      sourceUserIds: ["1001", "1002"],
      historicalBusinessStudentIds: ["H-1"],
      forms: [
        {
          grade: 11,
          formId: "6a44a83d1184e717b920c499",
          sessionId: "EnableStudents_6a44a83d1184e717b920c499",
          questions: [{ questionId: "g11-q1", position: 1, questionSetTitle: "Background" }],
        },
        {
          grade: 12,
          formId: "6a4deca8e030ebe34669fb0f",
          sessionId: "EnableStudents_6a4deca8e030ebe34669fb0f",
          questions: [{ questionId: "g12-q1", position: 1, questionSetTitle: "Background" }],
        },
      ],
    });
  });

  it("seeds deterministic fixture coverage without exposing fixture content in its report", async () => {
    let actorId = 500;
    const query = async (sql: string) => {
      if (sql.includes("fixture_scope")) {
        return { rows: [{ centre_id: 9, school_id: 10, school_code: "E2E-P1", grade_11_id: 11, grade_12_id: 12 }] };
      }
      if (sql.includes("fixture_students")) {
        return { rows: [
          { student_id: 101, user_id: 1001, grade: 11, batch_group_id: 801 },
          { student_id: 102, user_id: 1002, grade: 11, batch_group_id: 801 },
          { student_id: 103, user_id: 1003, grade: 11, batch_group_id: 801 },
          { student_id: 201, user_id: 2001, grade: 12, batch_group_id: 802 },
          { student_id: 202, user_id: 2002, grade: 12, batch_group_id: 802 },
          { student_id: 203, user_id: 2003, grade: 12, batch_group_id: 802 },
        ] };
      }
      if (sql.includes("fixture_actor")) return { rows: [{ id: actorId++ }] };
      if (sql.includes("fixture_plan")) return { rows: [{ id: 30 }] };
      if (sql.includes("fixture_phases")) {
        return { rows: Array.from({ length: 6 }, (_, index) => ({ id: 40 + index, position: index + 1 })) };
      }
      if (sql.includes("fixture_questions")) {
        return { rows: Array.from({ length: 6 }, (_, index) => ({ id: 60 + index, phase_id: 40 + index })) };
      }
      if (sql.includes("fixture_configuration")) return { rows: [{ id: 70 }] };
      return { rows: [] };
    };

    await expect(seedHolisticFixtures({ query } as never)).resolves.toEqual({
      schoolCode: "E2E-P1",
      academicYear: "2026-2027",
      students: 6,
      mappings: 5,
      profiles: 2,
      historicalNotes: 1,
      draftNotes: 1,
      submittedNotes: 1,
      phases: 6,
    });
  });
});
