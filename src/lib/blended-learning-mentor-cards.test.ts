import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import { listMentorCards } from "./blended-learning-mentees";

const mockQuery = vi.mocked(query);

const TODAY = "2026-10-22";

const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
};
const READ_ONLY_ADMIN: BlendedLearningAccess = {
  kind: "admin", role: "blended_admin", readOnly: true,
  actorEmail: "viewer@avantifellows.org",
};

// One active Mapping row as the shared Mentee query returns it (ids and
// grades come back from pg as strings).
function mapping(
  studentId: number,
  mentor: { id: number | string; name: string },
  overrides: { grade?: number | string | null; lastConversationOn?: string | null; legacyLastContactOn?: string | null } = {}
) {
  const lastConversationOn = overrides.lastConversationOn === undefined ? "2026-10-20" : overrides.lastConversationOn;
  return {
    mentor_user_id: mentor.id, mentor_name: mentor.name,
    student_id: String(studentId), first_name: "Student", last_name: String(studentId), gender: "Female",
    grade: overrides.grade === undefined ? "12" : overrides.grade,
    program_id: "80", program_name: "STP Voucher Delhi",
    last_conversation_on: lastConversationOn, last_conversation_id: lastConversationOn ? studentId * 10 : null,
    last_attempt_on: null, last_attempt_id: null,
    legacy_last_contact_on: overrides.legacyLastContactOn ?? null, open_draft_state: null,
  };
}

const FAIZAN = { id: "9001", name: "faizan Khan" };
const LOKESH = { id: 9002, name: "Lokesh" };
const ANITA = { id: 9003, name: "Anita" };

beforeEach(() => {
  mockQuery.mockReset();
});

describe("listMentorCards", () => {
  it("gives a Mentor no cards without reading", async () => {
    expect(await listMentorCards(MENTOR, TODAY)).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  describe("for a team lead", () => {
    const TEAM_LEAD: BlendedLearningAccess = {
      kind: "mentor", role: "blended_mentor", readOnly: false,
      actorEmail: "lead@test.local", mentorUserId: 9009, supervisedMentorUserIds: [9002, 9003],
    };
    const LEAD = { id: 9009, name: "Zed Lead" };

    // The names query, then the Mappings query (narrowed to the team).
    function givenTeam(names: { id: number; name: string }[], rows: ReturnType<typeof mapping>[]) {
      mockQuery.mockImplementation(async (sql: string) => (sql.includes("FROM \"user\" mentor\n") ? names : rows) as never);
    }

    it("reads only their own and their reportees' Mappings", async () => {
      givenTeam([], []);

      await listMentorCards(TEAM_LEAD, TODAY);

      const mappings = mockQuery.mock.calls.find(([sql]) => sql.includes("blended_learning_mentor_mentee_mappings"));
      expect(mappings?.[1]).toEqual(["2026-2027", [9009, 9002, 9003], null]);
      expect(mappings?.[0]).toContain("NOT EXISTS (SELECT 1 FROM student dropout_student");
    });

    it("puts their own card first, then reportees A–Z, each shown even with no Mentees", async () => {
      givenTeam(
        [LEAD, { id: 9003, name: "Anita" }, { id: 9002, name: "Lokesh" }],
        [mapping(501, LEAD), mapping(601, LOKESH, { grade: 13, lastConversationOn: "2026-09-01" })]
      );

      const cards = await listMentorCards(TEAM_LEAD, TODAY);

      expect(cards).toEqual([
        { mentorUserId: 9009, name: "Zed Lead", assigned: 1, grade12: 1, grade13: 0, talkedLast7: 1, notSpoken30Plus: 0 },
        { mentorUserId: 9003, name: "Anita", assigned: 0, grade12: 0, grade13: 0, talkedLast7: 0, notSpoken30Plus: 0 },
        { mentorUserId: 9002, name: "Lokesh", assigned: 1, grade12: 0, grade13: 1, talkedLast7: 0, notSpoken30Plus: 1 },
      ]);
    });
  });

  it("gives no cards when no Mentor has an active Mapping", async () => {
    mockQuery.mockResolvedValue([]);
    expect(await listMentorCards(READ_ONLY_ADMIN, TODAY)).toEqual([]);
  });

  it("reads every Mentor's Mappings for the current year, unnarrowed", async () => {
    mockQuery.mockResolvedValue([]);

    await listMentorCards(READ_ONLY_ADMIN, TODAY);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(["2026-2027", null, null]);
    // A dropout counts on no card, though their Mapping is still active.
    expect(mockQuery.mock.calls[0][0]).toContain(
      "mapping.ended_at IS NULL AND NOT EXISTS (SELECT 1 FROM student dropout_student"
    );
  });

  it("counts each Mentor's Mentees by grade and Last Contact recency, A–Z by name", async () => {
    mockQuery.mockResolvedValue([
      // Faizan: Grade 12 talked to 2 days ago, Grade 13 last talked to 51
      // days ago, and one with no grade and no Last Contact at all.
      mapping(501, FAIZAN),
      mapping(502, FAIZAN, { grade: 13, lastConversationOn: "2026-09-01" }),
      mapping(503, FAIZAN, { grade: null, lastConversationOn: null }),
      // Lokesh: a Grade 13 Mentee talked to 10 days ago (neither recent nor 30+).
      mapping(601, LOKESH, { grade: "13", lastConversationOn: "2026-10-12" }),
      // Anita: only a legacy last-contact date from the Profile Doc, long ago.
      mapping(701, ANITA, { lastConversationOn: null, legacyLastContactOn: "2026-06-14" }),
    ]);

    const cards = await listMentorCards(READ_ONLY_ADMIN, TODAY);

    expect(cards).toEqual([
      { mentorUserId: 9003, name: "Anita", assigned: 1, grade12: 1, grade13: 0, talkedLast7: 0, notSpoken30Plus: 1 },
      {
        mentorUserId: 9001, name: "faizan Khan", assigned: 3, grade12: 1, grade13: 1, talkedLast7: 1, notSpoken30Plus: 2,
      },
      { mentorUserId: 9002, name: "Lokesh", assigned: 1, grade12: 0, grade13: 1, talkedLast7: 0, notSpoken30Plus: 0 },
    ]);
  });
});
