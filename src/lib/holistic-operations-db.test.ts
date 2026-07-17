import { describe, expect, it, vi } from "vitest";

import { createHolisticOperationsDb } from "./holistic-operations-db";

const source = [{
  businessStudentId: "AF-100",
  sourceRecordKey: "record-100",
  sourceMentorId: "TEACHER-100",
  sourceStartedAt: "2025-12-17 10:00:00",
  sourceEndedAt: "2025-12-17 10:30:00",
  sourceTimezone: "Asia/Calcutta" as const,
  questions: [1, 2, 3, 4].map((position) => ({
    position,
    question: `Question ${position}`,
    answer: `Answer ${position}`,
  })),
}];

function operationsWithClientQuery(clientQuery: ReturnType<typeof vi.fn>) {
  const withTransaction = vi.fn(async (
    callback: (client: never) => Promise<unknown>
  ) => callback({ query: clientQuery } as never));
  return {
    operations: createHolisticOperationsDb({
      query: vi.fn() as never,
      withTransaction: withTransaction as never,
    }),
    withTransaction,
  };
}

describe("Holistic operator database adapter", () => {
  it("resolves launch scope from active Centres and safely scopes legacy Mentors", async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      business_student_id: "AF-100",
      student_id: "41",
      mentor_user_id: "91",
      eligible: true,
    }]);
    const operations = createHolisticOperationsDb({
      query: query as never,
      withTransaction: vi.fn() as never,
    });

    await expect(operations.historicalImport.resolve(source)).resolves.toEqual([{
      businessStudentId: "AF-100",
      studentId: 41,
      mentorUserId: 91,
      eligible: true,
    }]);

    const [sql, params] = query.mock.calls[0];
    const text = String(sql);
    expect(text).toContain("FROM centre_students roster_student");
    expect(text).toContain("JOIN centres centre ON centre.id = roster_student.centre_id");
    expect(text).toContain("roster_student.program_id = $4");
    expect(text).toContain("roster_student.academic_year = $3");
    expect(text).toContain("roster_student.grade = 12");
    expect(text).not.toContain("school.program_ids");
    expect(text).not.toContain("batch_enrollment");
    expect(text).toContain("centre.school_id = roster.school_id");
    expect(text).toContain("holistic_mentorship_privacy_deletions");
    expect(text).toContain("teacher.exit_date IS NULL");
    expect(text).toContain(
      "LOWER(BTRIM(teacher.teacher_id)) = LOWER(BTRIM(source.source_mentor_id))"
    );
    expect(text).toContain("permission.role = 'teacher'");
    expect(text).toContain("NOT (seat.role = ANY($5::text[]))");
    expect(params).toEqual([
      ["AF-100"],
      ["TEACHER-100"],
      "2026-2027",
      1,
      ["apm", "pm", "spm", "ph"],
    ]);
  });

  it("loads existing fingerprints for content-aware no-op checks", async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      student_id: "41",
      source_fingerprint: "fingerprint-41",
    }]);
    const operations = createHolisticOperationsDb({
      query: query as never,
      withTransaction: vi.fn() as never,
    });

    await expect(
      operations.historicalImport.existing([41], "approved_2025_holistic_export")
    ).resolves.toEqual(new Map([[41, "fingerprint-41"]]));
  });

  it("writes all four answers and source-time provenance in one transaction", async () => {
    const clientQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: "71" }] })
      .mockResolvedValue({ rows: [] });
    const { operations, withTransaction } = operationsWithClientQuery(clientQuery);

    await operations.historicalImport.insert([{
      studentId: 41,
      mentorUserId: null,
      sourceRecordKey: "record-100",
      sourceFingerprint: "fingerprint-100",
      sourceSnapshot: "sha256:snapshot",
      sourceStartedAt: source[0].sourceStartedAt,
      sourceEndedAt: source[0].sourceEndedAt,
      sourceTimezone: source[0].sourceTimezone,
      actorUserId: 7,
      questions: source[0].questions,
    }]);

    expect(withTransaction).toHaveBeenCalledOnce();
    expect(clientQuery).toHaveBeenCalledTimes(5);
    expect(clientQuery.mock.calls[0][1]).toEqual([
      41,
      null,
      "record-100",
      "fingerprint-100",
      7,
      JSON.stringify({
        source_snapshot: "sha256:snapshot",
        source_started_at: "2025-12-17 10:00:00",
        source_ended_at: "2025-12-17 10:30:00",
        source_timezone: "Asia/Calcutta",
      }),
    ]);
    expect(clientQuery.mock.calls.slice(1).map(([, params]) => params?.[1])).toEqual([1, 2, 3, 4]);
  });

  it("accepts a concurrent identical insert but rejects different source content", async () => {
    const write = {
      studentId: 41,
      mentorUserId: null,
      sourceRecordKey: "record-100",
      sourceFingerprint: "fingerprint-100",
      sourceSnapshot: "sha256:snapshot",
      sourceStartedAt: source[0].sourceStartedAt,
      sourceEndedAt: source[0].sourceEndedAt,
      sourceTimezone: source[0].sourceTimezone,
      actorUserId: 7,
      questions: source[0].questions,
    };
    const withDatabase = (storedFingerprint: string) => {
      const clientQuery = vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ source_fingerprint: storedFingerprint }] });
      const { operations } = operationsWithClientQuery(clientQuery);
      return { operations, clientQuery };
    };

    const identical = withDatabase("fingerprint-100");
    await expect(identical.operations.historicalImport.insert([write])).resolves.toBeUndefined();
    expect(identical.clientQuery).toHaveBeenCalledTimes(2);
    expect(String(identical.clientQuery.mock.calls[1][0])).toContain("FOR UPDATE");

    const different = withDatabase("different-fingerprint");
    await expect(different.operations.historicalImport.insert([write]))
      .rejects.toThrow("Historical Note source conflict");
  });

  it("loads rollover eligibility from the canonical target-year Program 1 roster", async () => {
    const query = vi.fn().mockResolvedValueOnce([{
      student_id: "41",
      mentor_user_id: "91",
      school_id: "21",
      eligible: true,
      already_mapped: false,
    }]);
    const operations = createHolisticOperationsDb({
      query: query as never,
      withTransaction: vi.fn() as never,
    });

    await expect(operations.rollover.candidates("2026-2027", "2027-2028"))
      .resolves.toEqual([{
        studentId: 41,
        mentorUserId: 91,
        schoolId: 21,
        eligible: true,
        alreadyMapped: false,
      }]);

    const [sql, params] = query.mock.calls[0];
    const text = String(sql);
    expect(text).toContain("JOIN centre_students roster_student");
    expect(text).toContain("roster_student.academic_year = $2");
    expect(text).toContain("roster_student.program_id = $3");
    expect(text).toContain("roster_centre.school_id = mapping.school_id");
    expect(text).toContain("mapping.program_id = $3");
    expect(text).toContain("next_mapping.academic_year = $2) AS already_mapped");
    expect(text).not.toContain("next_mapping.ended_at");
    expect(text).not.toContain("batch_enrollment");
    expect(text).not.toContain("grade_enrollment");
    expect(params).toEqual([
      "2026-2027",
      "2027-2028",
      1,
      ["apm", "pm", "spm", "ph"],
    ]);
  });

  it("serializes rollover, validates the actor, and reports an insert race as skipped", async () => {
    const clientQuery = vi.fn().mockImplementation((sql: unknown) => {
      const text = String(sql);
      if (text.includes('SELECT id FROM "user"')) return { rows: [{ id: "7" }] };
      if (text.includes("FROM holistic_mentorship_mentor_mentee_mappings mapping")) {
        return { rows: [{
          student_id: "41",
          mentor_user_id: "91",
          school_id: "21",
          eligible: true,
          already_mapped: false,
        }] };
      }
      return { rows: [] };
    });
    const { operations, withTransaction } = operationsWithClientQuery(clientQuery);

    await expect(operations.rollover.apply("2026-2027", "2027-2028", 7))
      .resolves.toEqual({ carried: 0, skipped: 1, ineligible: 0 });

    expect(withTransaction).toHaveBeenCalledOnce();
    expect(String(clientQuery.mock.calls[0][0])).toBe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    expect(String(clientQuery.mock.calls[1][0])).toContain("pg_advisory_xact_lock");
    expect(clientQuery.mock.calls[1][1]).toEqual([
      "holistic_mentorship_rollover:2026-2027:2027-2028",
    ]);
    expect(String(clientQuery.mock.calls[2][0])).toContain('SELECT id FROM "user"');
    const insert = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO holistic_mentorship_mentor_mentee_mappings")
    );
    expect(String(insert?.[0])).toContain("RETURNING id");
    expect(insert?.[1]).toEqual([41, 91, 21, 1, "2027-2028", 7]);
  });

  it("rejects an unknown rollover actor before reading or writing mappings", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const { operations } = operationsWithClientQuery(clientQuery);

    await expect(operations.rollover.apply("2026-2027", "2027-2028", 999999))
      .rejects.toThrow("Rollover actor does not exist");
    expect(clientQuery.mock.calls.some(([sql]) =>
      String(sql).includes("FROM holistic_mentorship_mentor_mentee_mappings mapping")
    )).toBe(false);
  });

  it("retries a serializable rollover conflict with a fresh transaction", async () => {
    const serializationFailure = Object.assign(new Error("retry"), { code: "40001" });
    const clientQuery = vi.fn().mockImplementation((sql: unknown) => {
      if (String(sql).includes('SELECT id FROM "user"')) return { rows: [{ id: "7" }] };
      return { rows: [] };
    });
    const withTransaction = vi.fn()
      .mockRejectedValueOnce(serializationFailure)
      .mockImplementationOnce(async (callback) => callback({ query: clientQuery } as never));
    const operations = createHolisticOperationsDb({
      query: vi.fn() as never,
      withTransaction: withTransaction as never,
    });

    await expect(operations.rollover.apply("2026-2027", "2027-2028", 7))
      .resolves.toEqual({ carried: 0, skipped: 0, ineligible: 0 });
    expect(withTransaction).toHaveBeenCalledTimes(2);
  });
});
