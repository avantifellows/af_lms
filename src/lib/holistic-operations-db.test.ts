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
    const withTransaction = vi.fn(async (callback) =>
      callback({ query: clientQuery } as never)
    );
    const operations = createHolisticOperationsDb({
      query: vi.fn() as never,
      withTransaction: withTransaction as never,
    });

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
      const operations = createHolisticOperationsDb({
        query: vi.fn() as never,
        withTransaction: vi.fn(async (callback) =>
          callback({ query: clientQuery } as never)
        ) as never,
      });
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
});
