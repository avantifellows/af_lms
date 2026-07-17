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
const sourceProvenance = {
  sourceStartedAt: "2025-12-17 10:00:00",
  sourceEndedAt: "2025-12-17 10:30:00",
  sourceTimezone: "Asia/Calcutta" as const,
};

function approvedHistoricalRecords(): HistoricalHolisticNoteSource[] {
  return [
    ...Array.from({ length: 39 }, (_, index) => ({
      ...sourceProvenance,
      businessStudentId: `eligible-${index}`,
      sourceRecordKey: `record-${index}`,
      sourceMentorId: index < 29 ? `mentor-${index}` : null,
      questions,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      ...sourceProvenance,
      businessStudentId: `empty-${index}`,
      sourceRecordKey: `empty-record-${index}`,
      sourceMentorId: `mentor-empty-${index}`,
      questions: questions.map((question) => ({ ...question, answer: null })),
    })),
    ...Array.from({ length: 11 }, (_, index) => ({
      ...sourceProvenance,
      businessStudentId: `unmatched-${index}`,
      sourceRecordKey: `unmatched-record-${index}`,
      sourceMentorId: null,
      questions,
    })),
  ];
}

function resolveApprovedRecords(
  records: HistoricalHolisticNoteSource[],
  eligible: (index: number) => boolean = () => true
) {
  return records.slice(0, 42).map((record, index) => ({
    businessStudentId: record.businessStudentId,
    studentId: index + 1,
    mentorUserId: record.sourceMentorId ? 100 + index : null,
    eligible: eligible(index),
  }));
}

function approvedImportInput(
  records: HistoricalHolisticNoteSource[],
  insert: ReturnType<typeof vi.fn>,
  existing = new Map<number, string>(),
  actorUserId = 7
) {
  return {
    mode: "apply" as const,
    actorUserId,
    sourceSnapshot: "approved-2026-07-14",
    source: { read: async () => records },
    db: {
      resolve: async () => resolveApprovedRecords(records),
      existing: async () => existing,
      insert,
    },
  };
}

describe("Historical Holistic Notes import entrypoint", () => {
  it("reconciles nullable Mentors across the safe cohort while skipping empty writes", async () => {
    const records = approvedHistoricalRecords();
    const insert = vi.fn();
    const report = await runHistoricalHolisticNotesImport({
      source: { read: async () => records },
      db: {
        resolve: async () => resolveApprovedRecords(records),
        existing: async () => new Map(),
        insert,
      },
    });

    expect(report).toMatchObject({
      ok: true,
      mode: "dry-run",
      counts: {
        safeCandidates: 42,
        writes: 39,
        emptySkips: 3,
        nullableMentors: 10,
        quarantinedUnmatched: 11,
      },
    });
    expect(report.blockers).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks apply when a source record does not contain the original four Question positions", async () => {
    const records = approvedHistoricalRecords();
    records[0] = { ...records[0], questions: questions.slice(0, 3) };
    const insert = vi.fn();
    const report = await runHistoricalHolisticNotesImport(
      approvedImportInput(records, insert)
    );

    expect(report.ok).toBe(false);
    expect(report.blockers).toContain(
      "Source records must contain approved provenance and Question positions 1 through 4"
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks direct imports with invalid source timestamp provenance", async () => {
    const records = approvedHistoricalRecords();
    records[0] = {
      ...records[0],
      sourceEndedAt: "2025-12-17 09:59:59",
    };
    const insert = vi.fn();
    const report = await runHistoricalHolisticNotesImport(
      approvedImportInput(records, insert)
    );

    expect(report.blockers).toContain(
      "Source records must contain approved provenance and Question positions 1 through 4"
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("applies once with provenance metadata and writes nothing on an unchanged rerun", async () => {
    const records = approvedHistoricalRecords();
    const imported = new Map<number, string>();
    const insert = vi.fn(async (writes: Array<{ studentId: number; sourceFingerprint: string }>) => {
      writes.forEach(({ studentId, sourceFingerprint }) =>
        imported.set(studentId, sourceFingerprint)
      );
    });
    const db = {
      resolve: async () => resolveApprovedRecords(records),
      existing: async () => new Map(imported),
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
    const records = approvedHistoricalRecords();
    const report = await runHistoricalHolisticNotesImport({
      mode: "apply", actorUserId: 7, sourceSnapshot: "approved-2026-07-14",
      source: { read: async () => records },
      db: {
        resolve: async () => resolveApprovedRecords(records, (index) => index !== 0),
        existing: async () => new Map(),
        insert: vi.fn(),
      },
    });

    expect(report.blockers).toContain("1 source Students are outside the approved current roster");
    expect(report.ok).toBe(false);
  });

  it("blocks apply when an existing Student record has different source content", async () => {
    const records = approvedHistoricalRecords();
    const insert = vi.fn();
    const report = await runHistoricalHolisticNotesImport(
      approvedImportInput(records, insert, new Map([[1, "different-fingerprint"]]))
    );

    expect(report.ok).toBe(false);
    expect(report.blockers).toContain(
      "1 existing Historical Notes records have different source content"
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects invalid direct apply metadata before writing", async () => {
    const records = approvedHistoricalRecords();
    const insert = vi.fn();
    const report = await runHistoricalHolisticNotesImport(
      approvedImportInput(records, insert, new Map(), -1)
    );

    expect(report.blockers).toContain("Apply requires actor and source-snapshot metadata");
    expect(insert).not.toHaveBeenCalled();
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
