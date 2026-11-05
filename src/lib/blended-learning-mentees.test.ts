import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import { listMentees } from "./blended-learning-mentees";

const mockQuery = vi.mocked(query);

const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
};
const ADMIN: BlendedLearningAccess = {
  kind: "admin", role: "blended_admin", readOnly: false,
  actorEmail: "juned@avantifellows.org",
};

function row(studentId: number, mentorUserId: number, name: string) {
  const [first_name, last_name] = name.split(" ");
  return {
    student_id: studentId, program_student_id: null as string | null, category: null as string | null,
    mentor_user_id: mentorUserId, first_name, last_name, gender: "Female",
    grade: 12, program_id: 80, program_name: "STP Voucher Delhi",
    last_conversation_on: "2026-10-20", last_conversation_id: studentId * 10,
    last_attempt_on: null as string | null, last_attempt_id: null as number | null, legacy_last_contact_on: null, open_draft_state: null,
  };
}

// Fixture: active current-year Mapping rows; the mock narrows them by the
// bound Mentor id the way the WHERE clause does.
function givenMappedMentees(rows: ReturnType<typeof row>[]) {
  mockQuery.mockImplementation(async (_sql: string, params?: unknown[]) => {
    const mentor = params?.[1];
    return rows.filter((r) => mentor == null || r.mentor_user_id === Number(mentor));
  });
}

const FAIZANS = row(501, 9001, "Ira Attempt");
const LOKESHS = row(601, 9002, "Tara Other");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("listMentees", () => {
  it("gives a Mentor only their own Mentees, even when asked for another Mentor's", async () => {
    givenMappedMentees([FAIZANS, LOKESHS]);

    const list = await listMentees({ access: MENTOR, mentorUserId: 9002, today: "2026-10-22" });

    expect([...list.talkToFirst, ...list.everyoneElse].map((m) => m.name)).toEqual(["Ira Attempt"]);
  });

  it("gives a Blended Learning Admin every Mentor's Mentees, or one Mentor's on request", async () => {
    givenMappedMentees([FAIZANS, LOKESHS]);

    const all = await listMentees({ access: ADMIN, today: "2026-10-22" });
    expect(all.everyoneElse.map((m) => m.name)).toEqual(["Ira Attempt", "Tara Other"]);

    const lokeshs = await listMentees({ access: ADMIN, mentorUserId: 9002, today: "2026-10-22" });
    expect(lokeshs.everyoneElse.map((m) => m.name)).toEqual(["Tara Other"]);
  });

  it("gives a Mentor with no Mentor user id an empty list without reading", async () => {
    givenMappedMentees([FAIZANS]);

    const list = await listMentees({ access: { ...MENTOR, mentorUserId: null }, today: "2026-10-22" });

    expect(list).toEqual({ talkToFirst: [], everyoneElse: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("carries the latest Attempt's date for the list's cells", async () => {
    givenMappedMentees([{ ...FAIZANS, last_attempt_on: "2026-10-21", last_attempt_id: 5099 }]);

    const list = await listMentees({ access: MENTOR, today: "2026-10-22" });

    expect(list.talkToFirst[0]).toMatchObject({
      reasons: ["attempt"],
      lastAttemptOn: "2026-10-21",
    });
    expect(list.talkToFirst[0]).not.toHaveProperty("lastDurationMinutes");
  });

  it("reads the program's Student ID as text with leading zeros, and the category", async () => {
    givenMappedMentees([
      { ...FAIZANS, program_student_id: "00123456", category: "Gen-EWS" },
      { ...LOKESHS, mentor_user_id: 9001 },
    ]);

    const list = await listMentees({ access: MENTOR, today: "2026-10-22" });

    expect(list.everyoneElse.map(({ studentId, programStudentId, category }) => ({ studentId, programStudentId, category })))
      .toEqual([
        { studentId: 501, programStudentId: "00123456", category: "Gen-EWS" },
        { studentId: 601, programStudentId: null, category: null },
      ]);
    expect(mockQuery.mock.calls[0][0]).toContain("st.student_id AS program_student_id, st.category");
  });
});
