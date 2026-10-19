import { describe, it, expect } from "vitest";
import { canonicalizeExamRecordsPayload } from "./exam-records-payload";

const EXAM_OPTIONS = [
  { id: 1, name: "JEE Mains" },
  { id: 2, name: "NEET" },
];

function canonicalize(input: unknown) {
  return canonicalizeExamRecordsPayload(input, EXAM_OPTIONS);
}

describe("canonicalizeExamRecordsPayload", () => {
  it("trims the application number and keeps a blank password as null", () => {
    const result = canonicalize({
      exams: [{ exam_id: 1, application_number: "  JEE123 ", application_password: "   " }],
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        exams: [
          {
            exam_id: 1,
            exam_name: "JEE Mains",
            application_number: "JEE123",
            application_password: null,
            sessions_applied: null,
          },
        ],
        removed_record_ids: [],
      },
    });
  });

  it("stores the sittings as a sorted set", () => {
    const result = canonicalize({
      exams: [{ exam_id: 1, application_number: "JEE123", sessions_applied: [2, 1, 2] }],
    });

    expect(result.ok && result.payload.exams[0].sessions_applied).toEqual([1, 2]);
  });

  it("treats no sittings as nothing stored", () => {
    const result = canonicalize({
      exams: [{ exam_id: 1, application_number: "JEE123", sessions_applied: [] }],
    });

    expect(result.ok && result.payload.exams[0].sessions_applied).toBeNull();
  });

  it("rejects a sitting the exam does not run", () => {
    const result = canonicalize({
      exams: [{ exam_id: 1, application_number: "JEE123", sessions_applied: [3] }],
    });

    expect(result).toEqual({
      ok: false,
      error: "Sessions applied for JEE Mains must be Session 1 or Session 2",
    });
  });

  it("rejects sittings on an exam that runs once a year", () => {
    const result = canonicalize({
      exams: [{ exam_id: 2, application_number: "NEET9", sessions_applied: [1] }],
    });

    expect(result).toEqual({ ok: false, error: "NEET does not run in sessions" });
  });

  it("requires an application number", () => {
    const result = canonicalize({
      exams: [{ exam_id: 2, application_number: "  ", application_password: "pw" }],
    });

    expect(result).toEqual({
      ok: false,
      error: "Application number is required for NEET",
    });
  });

  it("refuses an exam outside the competitive list", () => {
    const result = canonicalize({ exams: [{ exam_id: 23, application_number: "X1" }] });

    expect(result).toEqual({
      ok: false,
      error: "That exam cannot be recorded against a Student",
    });
  });

  it("refuses the same exam listed twice", () => {
    const result = canonicalize({
      exams: [
        { exam_id: 1, application_number: "A1" },
        { exam_id: 1, application_number: "A2" },
      ],
    });

    expect(result).toEqual({ ok: false, error: "JEE Mains is listed twice" });
  });

  it("refuses one application number on two exams, whatever the case", () => {
    const result = canonicalize({
      exams: [
        { exam_id: 1, application_number: "Shared1" },
        { exam_id: 2, application_number: "shared1" },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: "Application number shared1 is used for two exams",
    });
  });

  it("refuses an application number longer than the column", () => {
    const result = canonicalize({
      exams: [{ exam_id: 1, application_number: "X".repeat(256) }],
    });

    expect(result).toEqual({
      ok: false,
      error: "Application number for JEE Mains is too long",
    });
  });

  it("dedupes the removed record ids and rejects junk", () => {
    expect(canonicalize({ exams: [], removed_record_ids: [5, 5, 6] })).toEqual({
      ok: true,
      payload: { exams: [], removed_record_ids: [5, 6] },
    });
    expect(canonicalize({ exams: [], removed_record_ids: ["5"] })).toEqual({
      ok: false,
      error: "removed_record_ids is not valid",
    });
  });

  it("rejects a body that is not an object", () => {
    expect(canonicalize([])).toEqual({ ok: false, error: "Request body must be an object" });
    expect(canonicalize({ exams: "none" })).toEqual({
      ok: false,
      error: "exams must be a list",
    });
  });
});
