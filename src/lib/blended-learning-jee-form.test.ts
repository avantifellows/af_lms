import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { planExamRecordWrite } from "./blended-learning-jee-form";

const JEE = 1;
const row = (id: number, exam_id: number, exam_year: number | null, application_number: string, exam_name = "JEE Mains") => ({
  id,
  exam_id,
  exam_name,
  exam_year,
  application_number,
});

// The DB Service's create upserts on (student, application number), so the
// plan must never let a POST move another record.
describe("planExamRecordWrite", () => {
  it("creates a record when the Student has no JEE Mains 2027 record and no record with the number", () => {
    expect(planExamRecordWrite([], JEE, "2703")).toEqual({ kind: "create" });
    expect(planExamRecordWrite([row(5, JEE, 2026, "1111")], JEE, "2703")).toEqual({ kind: "create" });
    expect(planExamRecordWrite([row(5, JEE, null, "1111")], JEE, "2703")).toEqual({ kind: "create" });
  });

  it("updates the existing 2027 record, or leaves it when it already has the number", () => {
    expect(planExamRecordWrite([row(7, JEE, 2027, "1111")], JEE, "2703")).toEqual({ kind: "patch", id: 7 });
    expect(planExamRecordWrite([row(7, JEE, 2027, "2703")], JEE, "2703")).toEqual({ kind: "none" });
  });

  it("gives the year to a yearless JEE Mains record holding the number, ignoring case and spaces", () => {
    expect(planExamRecordWrite([row(5, JEE, null, " ab12 ")], JEE, "AB12")).toEqual({ kind: "patch", id: 5, examYear: 2027 });
  });

  it("refuses a number held by another exam, another year, or another record beside the 2027 one", () => {
    expect(planExamRecordWrite([row(9, 7, null, "2703", "JEE Advanced")], JEE, "2703")).toEqual({
      kind: "conflict",
      message: "This application number is already saved for JEE Advanced.",
    });
    expect(planExamRecordWrite([row(5, JEE, 2026, "2703")], JEE, "2703")).toEqual({
      kind: "conflict",
      message: "This application number is already saved for JEE Mains 2026.",
    });
    expect(planExamRecordWrite([row(7, JEE, 2027, "1111"), row(5, JEE, null, "2703")], JEE, "2703")).toMatchObject({
      kind: "conflict",
    });
  });
});
