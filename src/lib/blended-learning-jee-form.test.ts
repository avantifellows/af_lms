import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import type { BlendedLearningAccess } from "./blended-learning-access";
import { query } from "./db";
import { getJeeFormLine, listJeeFormRows, planExamRecordWrite } from "./blended-learning-jee-form";

const mockQuery = vi.mocked(query);

const JEE = 1;
const row = (
  id: number,
  exam_id: number,
  exam_year: number | null,
  application_number: string,
  exam_name = "JEE Mains",
  sessions_applied: number[] | null = [1]
) => ({
  id,
  exam_id,
  exam_name,
  exam_year,
  application_number,
  sessions_applied,
});

// The DB Service's create upserts on (student, application number), so the
// plan must never let a POST move another record, and the Student must never
// end up with two JEE Mains records.
describe("planExamRecordWrite", () => {
  it("creates a record only when the Student has no JEE Mains record at all", () => {
    expect(planExamRecordWrite([], JEE, "2703", [1])).toEqual({ kind: "create" });
    // Another exam's record with another number doesn't count.
    expect(planExamRecordWrite([row(9, 7, 2027, "1111", "JEE Advanced")], JEE, "2703", [1])).toEqual({ kind: "create" });
  });

  it("updates the existing 2027 record, or leaves it when it already has the number", () => {
    expect(planExamRecordWrite([row(7, JEE, 2027, "1111")], JEE, "2703", [1])).toEqual({ kind: "patch", id: 7 });
    expect(planExamRecordWrite([row(7, JEE, 2027, "2703")], JEE, "2703", [1])).toEqual({ kind: "none" });
  });

  it("patches the 2027 record when only the sessions differ, comparing them sorted and once each", () => {
    const saved = (sessions: number[] | null) => [row(7, JEE, 2027, "2703", "JEE Mains", sessions)];
    expect(planExamRecordWrite(saved([1]), JEE, "2703", [1, 2])).toEqual({ kind: "patch", id: 7 });
    expect(planExamRecordWrite(saved(null), JEE, "2703", [1])).toEqual({ kind: "patch", id: 7 });
    expect(planExamRecordWrite(saved([]), JEE, "2703", [2])).toEqual({ kind: "patch", id: 7 });
    expect(planExamRecordWrite(saved([2, 1, 2]), JEE, "2703", [1, 2])).toEqual({ kind: "none" });
  });

  it("takes over a yearless JEE Mains record holding another number, giving it the year", () => {
    expect(planExamRecordWrite([row(5, JEE, null, "1111")], JEE, "2703", [1])).toEqual({ kind: "patch", id: 5, examYear: 2027 });
  });

  it("takes over a yearless JEE Mains record holding the number, ignoring case and spaces, even with the same sessions", () => {
    expect(planExamRecordWrite([row(5, JEE, null, " ab12 ")], JEE, "AB12", [1])).toEqual({ kind: "patch", id: 5, examYear: 2027 });
  });

  it("takes over a JEE Mains record of another year, whatever its number", () => {
    expect(planExamRecordWrite([row(5, JEE, 2026, "1111")], JEE, "2703", [1])).toEqual({ kind: "patch", id: 5, examYear: 2027 });
    expect(planExamRecordWrite([row(5, JEE, 2026, "2703")], JEE, "2703", [1])).toEqual({ kind: "patch", id: 5, examYear: 2027 });
  });

  it("takes the newest older JEE Mains record (by id) when there are several", () => {
    const rows = [row(5, JEE, null, "1111"), row(12, JEE, 2026, "2222"), row(8, JEE, 2025, "3333")];
    expect(planExamRecordWrite(rows, JEE, "2703", [1])).toEqual({ kind: "patch", id: 12, examYear: 2027 });
  });

  it("prefers the 2027 record over an older one", () => {
    const rows = [row(5, JEE, null, "1111"), row(7, JEE, 2027, "2222"), row(9, JEE, 2026, "3333")];
    expect(planExamRecordWrite(rows, JEE, "2703", [1])).toEqual({ kind: "patch", id: 7 });
    expect(planExamRecordWrite([row(9, JEE, 2026, "3333"), row(7, JEE, 2027, "2703")], JEE, "2703", [1])).toEqual({ kind: "none" });
  });

  it("refuses a number held by another exam, with or without a JEE Mains record to take over", () => {
    expect(planExamRecordWrite([row(9, 7, null, "2703", "JEE Advanced")], JEE, "2703", [1])).toEqual({
      kind: "conflict",
      message: "This application number is already saved for JEE Advanced.",
    });
    for (const jee of [row(5, JEE, null, "1111"), row(7, JEE, 2027, "1111")]) {
      expect(planExamRecordWrite([jee, row(9, 7, 2027, " 2703 ", "JEE Advanced")], JEE, "2703", [1])).toEqual({
        kind: "conflict",
        message: "This application number is already saved for JEE Advanced 2027.",
      });
    }
  });

  it("refuses a number held by another JEE Mains record beside the target, never moving it", () => {
    expect(planExamRecordWrite([row(7, JEE, 2027, "1111"), row(5, JEE, null, "2703")], JEE, "2703", [1])).toEqual({
      kind: "conflict",
      message: "This application number is already saved for JEE Mains.",
    });
    // Two older records: the newest is the target, the other keeps its number.
    expect(planExamRecordWrite([row(5, JEE, 2026, "2703"), row(8, JEE, null, "1111")], JEE, "2703", [1])).toEqual({
      kind: "conflict",
      message: "This application number is already saved for JEE Mains 2026.",
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

// A team lead (9001) who supervises Mentor 9002, whose Mentee is Student 601.
const TEAM_LEAD: BlendedLearningAccess = { ...MENTOR, supervisedMentorUserIds: [9002] };
// The view-only status read's row, with a column it must never pass on.
const STATUS_ROW = { student_id: 601, status: "not_filled", reasons: ["not_aware"], recorded_on: "2026-11-14", application_number: "2799" };
// What a view-only status read may select, and what it must not.
const NOT_STATUS = /application_number|confirmation|details|password|student_exam_record|action_items/i;

describe("listJeeFormRows", () => {
  let sql: { text: string; params: unknown[] }[];
  const MAPPED = [
    { student_id: 501, program_student_id: "0501", first_name: "Asha", last_name: "Testcase", mentor_user_id: 9001, mentor_name: "Mentor Alpha" },
    { student_id: 502, program_student_id: null, first_name: "Biren", last_name: null, mentor_user_id: 9001, mentor_name: "Mentor Alpha" },
    { student_id: 601, program_student_id: "0601", first_name: "Chitra", last_name: "Sample", mentor_user_id: 9002, mentor_name: "Mentor Beta" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    sql = [];
    mockQuery.mockImplementation((async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
        const mentors = params[1] as number[] | null;
        return MAPPED.filter((row) => mentors === null || mentors.includes(row.mentor_user_id));
      }
      if (text.includes("SELECT DISTINCT ON (u.student_id)")) return [STATUS_ROW];
      if (text.includes("FROM blended_learning_jee_form_updates u")) {
        return [update(501, 12, "filled"), update(501, 10, "not_filled")];
      }
      if (text.includes("FROM blended_learning_action_items item")) {
        return [{ student_id: 502, id: 81, text: "JEE Form Filling (Reminder)", status: "open" }];
      }
      if (text.includes("FROM student_exam_record ser")) return [{ student_id: 501, application_number: null, ciphertext_saved: true }];
      throw new Error(`Unexpected query: ${text}`);
    }) as typeof query);
  });

  it("reads a Mentor's own Students with each one's current status, earlier updates and reminder", async () => {
    const rows = (await listJeeFormRows(MENTOR))!.map((row) => {
      if (row.viewOnly) throw new Error("a Mentor's own row is never view only");
      return row;
    });

    expect(rows?.map((row) => [row.studentId, row.programStudentId, row.name, row.mentorName])).toEqual([
      [501, "0501", "Asha Testcase", "Mentor Alpha"],
      [502, null, "Biren", "Mentor Alpha"],
    ]);
    expect(rows?.[0].form.current).toMatchObject({ id: 12, status: "filled", applicationNumber: "2712" });
    expect(rows?.[0].form.earlier.map((item) => item.id)).toEqual([10]);
    expect(rows?.[0].form.reminderItems).toEqual([]);
    expect(rows?.[0].form.passwordSaved).toBe(true);
    expect(rows?.[1].form).toEqual({
      current: null,
      earlier: [],
      reminderItems: [{ id: 81, text: "JEE Form Filling (Reminder)", status: "open" }],
      passwordSaved: false,
      sessionsApplied: [],
    });

    const mappings = sql.find(({ text }) => text.includes("FROM blended_learning_mentor_mentee_mappings"));
    expect(mappings?.params).toEqual(["2026-2027", [9001]]);
    expect(mappings?.text).toContain("mapping.mentor_user_id = ANY($2::bigint[])");
    expect(mappings?.text).toMatch(/mapping\.ended_at IS NULL/);
    // One read of the updates and one of the reminders for every Student.
    const updates = sql.filter(({ text }) => text.includes("FROM blended_learning_jee_form_updates u"));
    expect(updates.map(({ params }) => params)).toEqual([[[501, 502], 1, 2027]]);
    expect(updates[0].text).toMatch(/row_number\(\) OVER \(PARTITION BY u\.student_id ORDER BY u\.id DESC\)/);
    // One read of the reminders, found by the reminder's key (bound), not its text.
    const reminders = sql.filter(({ text }) => text.includes("FROM blended_learning_action_items item"));
    expect(reminders.map(({ params }) => params)).toEqual([[[501, 502], "jee_form_reminder"]]);
    expect(reminders[0].text).toMatch(/AND common\.key = \$2\s/);
    expect(reminders[0].text).not.toMatch(/common\.text|removed_at/);
    // One read of which Students' JEE Mains 2027 record holds a ciphertext.
    const saved = sql.filter(({ text }) => text.includes("FROM student_exam_record ser"));
    expect(saved.map(({ params }) => params)).toEqual([[[501, 502], 1, 2027]]);
    expect(saved[0].text).toMatch(/application_password_ciphertext IS NOT NULL/);
  });

  it("shows a Filled Student's number from the exam record, earlier updates keeping theirs", async () => {
    const records = [
      { student_id: 501, application_number: "2799", ciphertext_saved: true },
      { student_id: 502, application_number: "2788", ciphertext_saved: false },
    ];
    mockQuery.mockImplementation((async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) return MAPPED.slice(0, 2);
      if (text.includes("FROM blended_learning_jee_form_updates u")) {
        // 501: Filled (recorded 2712) after an earlier Filled (2711);
        // 502: Not filled, though a 2027 record holds a number.
        return [update(501, 12, "filled"), update(501, 11, "filled"), update(502, 13, "not_filled")];
      }
      if (text.includes("FROM blended_learning_action_items item")) return [];
      if (text.includes("FROM student_exam_record ser")) return records;
      throw new Error(`Unexpected query: ${text}`);
    }) as typeof query);

    const [asha, biren] = (await listJeeFormRows(MENTOR))!;
    if (asha.viewOnly || biren.viewOnly) throw new Error("own rows");
    expect(asha.form.current).toMatchObject({ id: 12, status: "filled", applicationNumber: "2799" });
    expect(asha.form.earlier).toMatchObject([{ id: 11, applicationNumber: "2711" }]);
    expect(biren.form.current).toMatchObject({ id: 13, status: "not_filled", applicationNumber: null });

    // A record without a number (or none at all): the number the update recorded.
    records[0] = { student_id: 501, application_number: null, ciphertext_saved: true };
    expect((await listJeeFormRows(MENTOR))![0].form.current).toMatchObject({ applicationNumber: "2712" });
    records.length = 0;
    expect((await listJeeFormRows(MENTOR))![0].form.current).toMatchObject({ applicationNumber: "2712" });

    // Named columns only, the JEE Mains 2027 record, a record with a number first.
    const read = sql.find(({ text }) => text.includes("FROM student_exam_record ser"))!;
    expect(read.params).toEqual([[501, 502], 1, 2027]);
    expect(read.text).toContain("ORDER BY ser.student_id, (COALESCE(btrim(ser.application_number), '') = ''), ser.id");
  });

  it("carries each Student's sessions applied from the exam record, sorted, [] without any", async () => {
    mockQuery.mockImplementation((async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) return MAPPED.slice(0, 2);
      if (text.includes("FROM blended_learning_jee_form_updates u")) return [update(501, 12, "filled")];
      if (text.includes("FROM blended_learning_action_items item")) return [];
      if (text.includes("FROM student_exam_record ser")) {
        return [
          { student_id: 501, application_number: "2799", sessions_applied: [2, 1], ciphertext_saved: true },
          { student_id: 502, application_number: "2788", sessions_applied: null, ciphertext_saved: false },
        ];
      }
      throw new Error(`Unexpected query: ${text}`);
    }) as typeof query);

    const [asha, biren] = (await listJeeFormRows(MENTOR))!;
    if (asha.viewOnly || biren.viewOnly) throw new Error("own rows");
    expect(asha.form.sessionsApplied).toEqual([1, 2]);
    expect(biren.form.sessionsApplied).toEqual([]);
    expect(sql.find(({ text }) => text.includes("FROM student_exam_record ser"))!.text).toContain("ser.sessions_applied");
  });

  it("gives a team lead their own Students' forms and their reportees' Students' status only", async () => {
    const rows = await listJeeFormRows(TEAM_LEAD);

    expect(sql.find(({ text }) => text.includes("FROM blended_learning_mentor_mentee_mappings"))?.params).toEqual([
      "2026-2027",
      [9001, 9002],
    ]);
    expect(rows?.map((row) => [row.studentId, row.viewOnly])).toEqual([
      [501, false],
      [502, false],
      [601, true],
    ]);
    // Exactly the status: no application number, sessions, details,
    // confirmation, history, reminder or password flag, whatever the row read
    // returned.
    expect(rows?.[2].form).toEqual({
      statusOnly: true,
      current: { status: "not_filled", reasons: ["not_aware"], recordedOn: "2026-11-14" },
    });

    // The supervised Student's status comes from its own narrow read; the
    // full reads (updates, reminders, exam records) never include them.
    const statusReads = sql.filter(({ text }) => text.includes("SELECT DISTINCT ON (u.student_id)"));
    expect(statusReads.map(({ params }) => params)).toEqual([[[601], 1, 2027]]);
    expect(statusReads[0].text).not.toMatch(NOT_STATUS);
    const fullReads = sql.filter(
      ({ text }) =>
        text.includes("FROM student_exam_record") ||
        text.includes("FROM blended_learning_action_items") ||
        (text.includes("FROM blended_learning_jee_form_updates u") && !text.includes("DISTINCT ON"))
    );
    expect(fullReads).toHaveLength(3);
    for (const { params } of fullReads) expect(params[0]).toEqual([501, 502]);
  });

  it("gives a team lead a status-only row as Not recorded when nothing is recorded", async () => {
    mockQuery.mockImplementation((async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) return [MAPPED[2]];
      return [];
    }) as typeof query);

    expect((await listJeeFormRows(TEAM_LEAD))?.[0]).toMatchObject({ viewOnly: true, form: { statusOnly: true, current: null } });
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

  it("never selects everything, the ciphertext or the legacy plaintext password", async () => {
    await listJeeFormRows(ADMIN);
    await listJeeFormRows(TEAM_LEAD);
    for (const { text } of sql) {
      // Only `application_password_ciphertext IS NOT NULL`, never the column's value.
      expect(text.replace(/application_password_ciphertext IS NOT NULL/g, "")).not.toMatch(/password/i);
      expect(text).not.toMatch(/SELECT\s+\*/i);
    }
  });
});

describe("getJeeFormLine", () => {
  let sql: { text: string; params: unknown[] }[];
  // Active current-year Mappings: Student → Mentor.
  const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002, 701: 9003 };

  beforeEach(() => {
    vi.clearAllMocks();
    sql = [];
    mockQuery.mockImplementation((async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) {
        const mentor = MAPPINGS[Number(params[0])];
        return mentor ? [{ mentor_user_id: mentor }] : [];
      }
      if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
      if (text.includes("SELECT DISTINCT ON (u.student_id)")) return [STATUS_ROW];
      if (text.includes("FROM blended_learning_jee_form_updates u")) return [update(501, 12, "filled")];
      if (text.includes("FROM blended_learning_action_items item")) return [];
      if (text.includes("FROM student_exam_record ser")) return [{ student_id: 501, application_number: null, ciphertext_saved: true }];
      throw new Error(`Unexpected query: ${text}`);
    }) as typeof query);
  });

  it("gives the whole form in full scope: a Mentor's own Mentee, any mapped Student for an admin", async () => {
    for (const access of [MENTOR, TEAM_LEAD, ADMIN]) {
      expect(await getJeeFormLine(access, 501)).toMatchObject({
        current: { status: "filled", applicationNumber: "2712" },
        passwordSaved: true,
      });
    }
    expect(await getJeeFormLine(ADMIN, 601)).toMatchObject({ earlier: [], passwordSaved: false });
    expect(sql.some(({ text }) => text.includes("SELECT DISTINCT ON (u.student_id)"))).toBe(false);
  });

  it("shows the exam record's number on the Mentee page's line", async () => {
    mockQuery.mockImplementation((async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes("FROM blended_learning_mentor_mentee_mappings")) return [{ mentor_user_id: 9001 }];
      if (text.includes("FROM exam WHERE name")) return [{ id: 1 }];
      if (text.includes("FROM blended_learning_jee_form_updates u")) return [update(501, 12, "filled")];
      if (text.includes("FROM blended_learning_action_items item")) return [];
      if (text.includes("FROM student_exam_record ser")) return [{ student_id: 501, application_number: "2799", ciphertext_saved: true }];
      throw new Error(`Unexpected query: ${text}`);
    }) as typeof query);
    expect(await getJeeFormLine(MENTOR, 501)).toMatchObject({ current: { applicationNumber: "2799" } });
  });

  it("gives a team lead only the status of a supervised Mentor's Mentee, from a read of the status alone", async () => {
    const line = await getJeeFormLine(TEAM_LEAD, 601);

    expect(line).toEqual({
      statusOnly: true,
      current: { status: "not_filled", reasons: ["not_aware"], recordedOn: "2026-11-14" },
    });
    const jeeReads = sql.filter(({ text }) => !text.includes("mentee_mappings") && !text.includes("FROM exam WHERE name"));
    expect(jeeReads).toHaveLength(1);
    expect(jeeReads[0].text).toContain("SELECT DISTINCT ON (u.student_id)");
    expect(jeeReads[0].text).not.toMatch(NOT_STATUS);
    expect(jeeReads[0].params).toEqual([[601], 1, 2027]);
  });

  it("gives nothing out of scope (another Mentor's Mentee, or a team lead's non-reportee), reading no JEE data", async () => {
    expect(await getJeeFormLine(MENTOR, 601)).toBeNull();
    expect(await getJeeFormLine(TEAM_LEAD, 701)).toBeNull();
    expect(sql.every(({ text }) => text.includes("mentee_mappings"))).toBe(true);
  });
});
