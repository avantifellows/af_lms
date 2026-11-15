import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import type { BlendedLearningAccess } from "./blended-learning-access";
import { query } from "./db";
import { listJeeFormRows, planExamRecordWrite } from "./blended-learning-jee-form";

const mockQuery = vi.mocked(query);

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

const MENTOR: BlendedLearningAccess = {
  kind: "mentor",
  role: "blended_mentor",
  readOnly: false,
  actorEmail: "mentor@example.org",
  mentorUserId: 9001,
};
const ADMIN: BlendedLearningAccess = { kind: "admin", role: "blended_admin", readOnly: true, actorEmail: "admin@example.org" };

const update = (student_id: number, id: number, status: "filled" | "not_filled") => ({
  student_id,
  id,
  status,
  application_number: status === "filled" ? `27${id}` : null,
  confirmation_document_id: null,
  has_confirmation: false,
  reasons: status === "filled" ? null : ["not_aware"],
  details: null,
  recorded_on: "2026-11-12",
  flag_raised: status === "not_filled",
});

describe("listJeeFormRows", () => {
  let sql: { text: string; params: unknown[] }[];

  beforeEach(() => {
    vi.clearAllMocks();
    sql = [];
    mockQuery.mockImplementation((async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
        return [
          { student_id: 501, program_student_id: "0501", first_name: "Asha", last_name: "Testcase", mentor_user_id: 9001, mentor_name: "Mentor Alpha" },
          { student_id: 502, program_student_id: null, first_name: "Biren", last_name: null, mentor_user_id: 9001, mentor_name: "Mentor Alpha" },
        ];
      }
      if (text.includes("FROM blended_learning_jee_form_updates u")) {
        return [update(501, 12, "filled"), update(501, 10, "not_filled")];
      }
      if (text.includes("FROM blended_learning_action_items item")) {
        return [{ student_id: 502, id: 81, text: "JEE Form Filling (Reminder)", status: "open" }];
      }
      throw new Error(`Unexpected query: ${text}`);
    }) as typeof query);
  });

  it("reads a Mentor's own Students with each one's current status, earlier updates and reminder", async () => {
    const rows = await listJeeFormRows(MENTOR);

    expect(rows?.map((row) => [row.studentId, row.programStudentId, row.name, row.mentorName])).toEqual([
      [501, "0501", "Asha Testcase", "Mentor Alpha"],
      [502, null, "Biren", "Mentor Alpha"],
    ]);
    expect(rows?.[0].form.current).toMatchObject({ id: 12, status: "filled", applicationNumber: "2712" });
    expect(rows?.[0].form.earlier.map((item) => item.id)).toEqual([10]);
    expect(rows?.[0].form.reminderItems).toEqual([]);
    expect(rows?.[1].form).toEqual({
      current: null,
      earlier: [],
      reminderItems: [{ id: 81, text: "JEE Form Filling (Reminder)", status: "open" }],
    });

    const mappings = sql.find(({ text }) => text.includes("FROM blended_learning_mentor_mentee_mappings"));
    expect(mappings?.params).toEqual(["2026-2027", 9001]);
    expect(mappings?.text).toMatch(/mapping\.ended_at IS NULL/);
    // One read of the updates and one of the reminders for every Student.
    const updates = sql.filter(({ text }) => text.includes("FROM blended_learning_jee_form_updates u"));
    expect(updates.map(({ params }) => params)).toEqual([[[501, 502], 1, 2027]]);
    expect(updates[0].text).toMatch(/row_number\(\) OVER \(PARTITION BY u\.student_id ORDER BY u\.id DESC\)/);
  });

  it("reads every Mentor's Students for an admin", async () => {
    await listJeeFormRows(ADMIN);
    expect(sql.find(({ text }) => text.includes("FROM blended_learning_mentor_mentee_mappings"))?.params).toEqual([
      "2026-2027",
      null,
    ]);
  });

  it("reads nothing for a Mentor with no linked user, and is null without a JEE Mains exam", async () => {
    expect(await listJeeFormRows({ ...MENTOR, mentorUserId: null })).toEqual([]);
    expect(sql).toEqual([]);
    mockQuery.mockResolvedValue([]);
    expect(await listJeeFormRows(ADMIN)).toBeNull();
  });

  it("never selects everything or names the application password", async () => {
    await listJeeFormRows(ADMIN);
    for (const { text } of sql) {
      expect(text).not.toMatch(/password/i);
      expect(text).not.toMatch(/SELECT\s+\*/i);
    }
  });
});
