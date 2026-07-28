import { describe, expect, it } from "vitest";

import {
  assertApprovedHistoricalSourceCounts,
  transformHistoricalHolisticSourceCsv,
} from "./holistic-historical-source";

const headers = [
  "student_id", "question_position_index", "question_type", "question_text",
  "user_response", "matrix_option", "matrix_response", "start_quiz_time", "end_quiz_time",
];
const sourceRows = [
  ["S-1", "0", "subjective", "Teacher ID", "T-1", "", ""],
  ["S-1", "1", "subjective", "Student Name", "Student One", "", ""],
  ["S-1", "2", "subjective", "Mentor Name", "Mentor One", "", ""],
  ["S-1", "3", "matrix-subjective", "Academic challenges", "ignored", "Math", "Needs help"],
  ["S-1", "3", "matrix-subjective", "Academic challenges", "ignored", "Physics", "On track"],
  ["S-1", "4", "matrix-subjective", "Academic support", "ignored", "Plan", "Weekly review"],
  ["S-1", "5", "matrix-subjective", "Other challenges", "", "", ""],
  ["S-1", "6", "matrix-subjective", "Other support", "ignored", "Wellbeing", "Check in"],
].map((row) => [...row, "2025-12-17 10:00:00", "2025-12-17 10:30:00"]);

function csv(rows = sourceRows, sourceHeaders = headers): string {
  return [sourceHeaders, ...rows].map((row) => row.map((cell) =>
    `"${cell.replaceAll('"', '""')}"`
  ).join(",")).join("\n");
}

describe("Historical Notes private-source preparation", () => {
  it("groups the reviewed source deterministically with original matrix labels and provenance", () => {
    const result = transformHistoricalHolisticSourceCsv(csv(), ["S-1"]);

    expect(result.counts).toEqual({
      sourceRows: 8,
      sourceStudents: 1,
      selectedStudents: 1,
      substantive: 1,
      empty: 0,
    });
    expect(result.records[0]).toEqual({
      businessStudentId: "S-1",
      sourceRecordKey: "approved_2025_holistic_export:S-1",
      sourceMentorId: "T-1",
      sourceStartedAt: "2025-12-17 10:00:00",
      sourceEndedAt: "2025-12-17 10:30:00",
      sourceTimezone: "Asia/Calcutta",
      questions: [
        { position: 1, question: "Academic challenges", answer: "Math: Needs help\nPhysics: On track" },
        { position: 2, question: "Academic support", answer: "Plan: Weekly review" },
        { position: 3, question: "Other challenges", answer: null },
        { position: 4, question: "Other support", answer: "Wellbeing: Check in" },
      ],
    });
  });

  it("requires the exact approved headers and reviewed ID set", () => {
    expect(() => transformHistoricalHolisticSourceCsv(
      csv(sourceRows, ["wrong_header", ...headers.slice(1)]), ["S-1"]
    )).toThrow("Historical CSV headers are invalid");
    expect(() => transformHistoricalHolisticSourceCsv(csv(), ["missing"])).toThrow(
      "Reviewed Student list does not match the private source"
    );

    const paddedStudentRows = sourceRows.map((row) => [
      ` ${row[0]} `,
      ...row.slice(1),
    ]);
    expect(() => transformHistoricalHolisticSourceCsv(
      csv(paddedStudentRows), ["S-1"]
    )).toThrow("Historical CSV rows are invalid");
    expect(() => transformHistoricalHolisticSourceCsv(csv(), [" S-1 "]))
      .toThrow("Reviewed Student list is invalid");
  });

  it("requires the complete approved expanded-row snapshot", () => {
    expect(() => assertApprovedHistoricalSourceCounts({
      sourceRows: 3_300,
      sourceStudents: 159,
      selectedStudents: 53,
      substantive: 44,
      empty: 9,
    })).toThrow("Historical source counts differ from the approved private snapshot");
    expect(() => assertApprovedHistoricalSourceCounts({
      sourceRows: 3_301,
      sourceStudents: 159,
      selectedStudents: 53,
      substantive: 44,
      empty: 9,
    })).not.toThrow();
  });

  it("rejects duplicate or one-sided matrix rows without exposing source identity", () => {
    const badRows = sourceRows.map((row) => [...row]);
    badRows[3][6] = "";
    expect(() => transformHistoricalHolisticSourceCsv(csv(badRows), ["S-1"]))
      .toThrow("Historical CSV matrix rows are invalid");

    try {
      transformHistoricalHolisticSourceCsv(csv(badRows), ["S-1"]);
    } catch (error) {
      expect(String(error)).not.toContain("S-1");
    }
  });

  it("rejects inconsistent source timestamps", () => {
    const badRows = sourceRows.map((row) => [...row]);
    badRows[3][7] = "2025-12-18 10:00:00";
    expect(() => transformHistoricalHolisticSourceCsv(csv(badRows), ["S-1"]))
      .toThrow("Historical CSV source timestamps are invalid");

    const malformedRows = sourceRows.map((row) => [...row]);
    malformedRows.forEach((row) => { row[7] = "2025-02-30 10:00:00"; });
    expect(() => transformHistoricalHolisticSourceCsv(csv(malformedRows), ["S-1"]))
      .toThrow("Historical CSV source timestamps are invalid");
  });
});
