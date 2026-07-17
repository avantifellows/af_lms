import { describe, expect, it, vi } from "vitest";

import {
  runHistoricalHolisticNotesImport,
  runHolisticMappingRollover,
  type HistoricalHolisticNoteSource,
} from "./holistic-operations";

const questions = [1, 2, 3, 4].map((position) => ({
  position,
  question: `Question ${position}`,
  answer: `Answer ${position}`,
}));

describe("Historical Holistic Notes import entrypoint", () => {
  it("does not count empty skipped records as nullable Mentor attributions", async () => {
    const records: HistoricalHolisticNoteSource[] = [
      ...Array.from({ length: 32 }, (_, index) => ({
        businessStudentId: `eligible-${index}`,
        sourceRecordKey: `record-${index}`,
        sourceMentorId: `mentor-${index}`,
        questions,
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        businessStudentId: `nullable-${index}`,
        sourceRecordKey: `nullable-record-${index}`,
        sourceMentorId: null,
        questions,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        businessStudentId: `empty-${index}`,
        sourceRecordKey: `empty-record-${index}`,
        sourceMentorId: null,
        questions: questions.map((question) => ({ ...question, answer: null })),
      })),
      ...Array.from({ length: 11 }, (_, index) => ({
        businessStudentId: `unmatched-${index}`,
        sourceRecordKey: `unmatched-record-${index}`,
        sourceMentorId: null,
        questions,
      })),
    ];
    const insert = vi.fn();
    const report = await runHistoricalHolisticNotesImport({
      source: { read: async () => records },
      db: {
        resolve: async () => records.flatMap((record, index) =>
          record.businessStudentId.startsWith("unmatched-") ? [] : [{
            businessStudentId: record.businessStudentId,
            studentId: index + 1,
            mentorUserId: record.sourceMentorId ? 100 + index : null,
            eligible: true,
          }]
        ),
        existing: async () => new Set(),
        insert,
      },
    });

    expect(report).toMatchObject({
      ok: false,
      mode: "dry-run",
      counts: {
        safeCandidates: 42,
        writes: 39,
        emptySkips: 3,
        nullableMentors: 7,
        quarantinedUnmatched: 11,
      },
    });
    expect(report.blockers).toContain("Reconciliation counts differ from the approved 42/39/3/10/11 baseline");
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks apply when a source record does not contain the original four Question positions", async () => {
    const records = Array.from({ length: 53 }, (_, index) => ({
      businessStudentId: `student-${index}`,
      sourceRecordKey: `record-${index}`,
      sourceMentorId: index < 32 ? `mentor-${index}` : null,
      questions: index === 0 ? questions.slice(0, 3) : index < 39 ? questions :
        questions.map((question) => ({ ...question, answer: null })),
    }));
    const insert = vi.fn();
    const report = await runHistoricalHolisticNotesImport({
      mode: "apply",
      actorUserId: 7,
      sourceSnapshot: "approved-2026-07-14",
      source: { read: async () => records },
      db: {
        resolve: async () => records.slice(0, 42).map((record, index) => ({
          businessStudentId: record.businessStudentId,
          studentId: index + 1,
          mentorUserId: index < 32 ? 100 + index : null,
          eligible: true,
        })),
        existing: async () => new Set(),
        insert,
      },
    });

    expect(report.ok).toBe(false);
    expect(report.blockers).toContain("Source records must contain Question positions 1, 2, 3, and 4 exactly once");
    expect(insert).not.toHaveBeenCalled();
  });

  it("applies once with provenance metadata and writes nothing on an unchanged rerun", async () => {
    const records = [
      ...Array.from({ length: 39 }, (_, index) => ({
        businessStudentId: `eligible-${index}`, sourceRecordKey: `record-${index}`,
        sourceMentorId: index < 29 ? `mentor-${index}` : null, questions,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        businessStudentId: `empty-${index}`, sourceRecordKey: `empty-record-${index}`,
        sourceMentorId: `mentor-empty-${index}`,
        questions: questions.map((question) => ({ ...question, answer: null })),
      })),
      ...Array.from({ length: 11 }, (_, index) => ({
        businessStudentId: `unmatched-${index}`, sourceRecordKey: `unmatched-record-${index}`,
        sourceMentorId: null, questions,
      })),
    ];
    const imported = new Set<number>();
    const insert = vi.fn(async (writes: Array<{ studentId: number }>) => {
      writes.forEach(({ studentId }) => imported.add(studentId));
    });
    const db = {
      resolve: async () => records.slice(0, 42).map((record, index) => ({
        businessStudentId: record.businessStudentId, studentId: index + 1,
        mentorUserId: index < 29 || index >= 39 ? 100 + index : null,
        eligible: true,
      })),
      existing: async () => new Set(imported),
      insert,
    };
    const input = {
      mode: "apply" as const, actorUserId: 7, sourceSnapshot: "approved-2026-07-14",
      source: { read: async () => records }, db,
    };

    const first = await runHistoricalHolisticNotesImport(input);
    const rerun = await runHistoricalHolisticNotesImport(input);

    expect(first.counts.writes).toBe(39);
    expect(insert.mock.calls[0][0][0]).toMatchObject({
      actorUserId: 7, sourceSnapshot: "approved-2026-07-14",
      questions,
    });
    expect(rerun.counts.writes).toBe(0);
  });

  it("blocks an exact business Student ID whose current roster is outside launch scope", async () => {
    const records = Array.from({ length: 53 }, (_, index) => ({
      businessStudentId: `student-${index}`, sourceRecordKey: `record-${index}`,
      sourceMentorId: index < 32 ? `mentor-${index}` : null,
      questions: index < 39 ? questions : index < 42
        ? questions.map((question) => ({ ...question, answer: null })) : questions,
    }));
    const report = await runHistoricalHolisticNotesImport({
      mode: "apply", actorUserId: 7, sourceSnapshot: "approved-2026-07-14",
      source: { read: async () => records },
      db: {
        resolve: async () => records.slice(0, 42).map((record, index) => ({
          businessStudentId: record.businessStudentId, studentId: index + 1,
          mentorUserId: index < 32 ? 100 + index : null, eligible: index !== 0,
        })),
        existing: async () => new Set(),
        insert: vi.fn(),
      },
    });

    expect(report.blockers).toContain("1 source Students are outside the approved current roster");
    expect(report.ok).toBe(false);
  });
});

describe("Holistic Mapping rollover entrypoint", () => {
  it("rejects a target that is not the next Academic Year before data access", async () => {
    const db = { candidates: vi.fn(), apply: vi.fn() };
    await expect(runHolisticMappingRollover({
      fromAcademicYear: "2026-2027",
      toAcademicYear: "2028-2029",
      actorUserId: 7,
      db,
    })).rejects.toThrow("Rollover target must be the next Academic Year");
    expect(db.candidates).not.toHaveBeenCalled();
  });

  it("defaults to dry-run and reports carried, skipped, and ineligible aggregates without writes", async () => {
    const apply = vi.fn();
    const report = await runHolisticMappingRollover({
      fromAcademicYear: "2026-2027",
      toAcademicYear: "2027-2028",
      actorUserId: 7,
      db: {
        candidates: async () => [
          { studentId: 1, mentorUserId: 11, schoolId: 101, eligible: true, alreadyMapped: false },
          { studentId: 2, mentorUserId: 12, schoolId: 102, eligible: true, alreadyMapped: true },
          { studentId: 3, mentorUserId: 13, schoolId: 103, eligible: false, alreadyMapped: false },
        ],
        apply,
      },
    });

    expect(report).toEqual({
      ok: true,
      mode: "dry-run",
      counts: { carried: 1, skipped: 1, ineligible: 1 },
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("atomically carries eligible pairs once and treats an unchanged rerun as skipped", async () => {
    let alreadyMapped = false;
    const input = {
      mode: "apply" as const,
      fromAcademicYear: "2026-2027", toAcademicYear: "2027-2028", actorUserId: 7,
      db: {
        candidates: async () => [{
          studentId: 1, mentorUserId: 11, schoolId: 101, eligible: true, alreadyMapped,
        }],
        apply: vi.fn(async () => {
          const counts = alreadyMapped
            ? { carried: 0, skipped: 1, ineligible: 0 }
            : { carried: 1, skipped: 0, ineligible: 0 };
          alreadyMapped = true;
          return counts;
        }),
      },
    };

    expect((await runHolisticMappingRollover(input)).counts).toEqual({ carried: 1, skipped: 0, ineligible: 0 });
    expect((await runHolisticMappingRollover(input)).counts).toEqual({ carried: 0, skipped: 1, ineligible: 0 });
    expect(input.db.apply).toHaveBeenCalledTimes(2);
  });
});
