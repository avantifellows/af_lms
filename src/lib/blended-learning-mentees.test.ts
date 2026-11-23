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

// The Mapping source's "period contains now" predicate.
const CONTAINS_NOW =
  "mapping.started_at <= (now() AT TIME ZONE 'UTC') AND (mapping.ended_at IS NULL OR mapping.ended_at > (now() AT TIME ZONE 'UTC'))";

// Fixture: current-year Mapping rows, of which `startsLater` are dated to
// start in the future (rows that end in the future still contain now); the
// mock narrows them by the bound Mentor ids and, when the SQL has the period
// predicate, drops those, as the WHERE clause does.
function givenMappedMentees(rows: ReturnType<typeof row>[], startsLater: ReturnType<typeof row>[] = []) {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const mentors = params?.[1] as number[] | null;
    const currentOnly = sql.includes(CONTAINS_NOW);
    return rows
      .filter((r) => mentors == null || mentors.includes(r.mentor_user_id))
      .filter((r) => !currentOnly || !startsLater.includes(r));
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

  it("leaves out Mentees marked a dropout, though their Mapping is still active", async () => {
    givenMappedMentees([FAIZANS]);

    await listMentees({ access: ADMIN, today: "2026-10-22" });

    expect(mockQuery.mock.calls[0][0]).toMatch(
      /WHERE mapping\.academic_year = \$1 AND mapping\.started_at <= \(now\(\) AT TIME ZONE 'UTC'\) AND \(mapping\.ended_at IS NULL OR mapping\.ended_at > \(now\(\) AT TIME ZONE 'UTC'\)\) AND NOT EXISTS \(SELECT 1 FROM student dropout_student\s+WHERE dropout_student\.id = mapping\.student_id AND dropout_student\.status = 'dropout'\)/
    );
  });

  it("leaves out a Mentee whose Mapping starts later, for the Mentor and an admin", async () => {
    const later = row(502, 9001, "Uma Later");
    givenMappedMentees([FAIZANS, later], [later]);

    const own = await listMentees({ access: MENTOR, today: "2026-10-22" });
    expect([...own.talkToFirst, ...own.everyoneElse].map((m) => m.name)).toEqual(["Ira Attempt"]);

    const all = await listMentees({ access: ADMIN, today: "2026-10-22" });
    expect([...all.talkToFirst, ...all.everyoneElse].map((m) => m.name)).toEqual(["Ira Attempt"]);
  });

  it("lists a reassigned Mentee under the old Mentor until the new Mapping starts", async () => {
    // db-service ends the old Mapping at the new one's (future) started_at.
    const oldMapping = row(503, 9001, "Rhea Handover");
    const newMapping = row(503, 9002, "Rhea Handover");
    givenMappedMentees([oldMapping, newMapping], [newMapping]);

    const own = await listMentees({ access: MENTOR, today: "2026-10-22" });
    expect([...own.talkToFirst, ...own.everyoneElse].map((m) => m.name)).toEqual(["Rhea Handover"]);

    const theirs = await listMentees({ access: ADMIN, mentorUserId: 9002, today: "2026-10-22" });
    expect([...theirs.talkToFirst, ...theirs.everyoneElse]).toEqual([]);
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
