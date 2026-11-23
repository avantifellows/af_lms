import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import { countNewFlags, flagsCutoffParam, listFlagMentors, listFlags, parseFlagsCutoff } from "./blended-learning-flags";

const mockQuery = vi.mocked(query);

const ADMIN: BlendedLearningAccess = {
  kind: "admin", role: "blended_admin", readOnly: true,
  actorEmail: "juned@avantifellows.org",
};

const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
};

const FLAG_ROW = {
  id: 7, recipient: "maths", comment: "Needs help", is_new: true, in_scope: false,
  conversation_id: 70, occurred_on: "2026-10-20", has_notes: true, mentor_user_id: 9001, mentor_name: "Faizan",
  student_id: 501, first_name: "Ira", last_name: "Attempt", grade: 12, program_name: "STP", gender: "Female",
  phone: null, whatsapp_phone: null, profile_doc_url: null, screener_url: null,
};

beforeEach(() => {
  mockQuery.mockReset();
});

describe("the Flags visit cutoff", () => {
  it("round-trips a last-seen time and a first visit through the URL", () => {
    expect(flagsCutoffParam({ lastSeenAt: "2026-10-21T09:30:00" })).toBe("2026-10-21T09:30:00");
    expect(parseFlagsCutoff("2026-10-21T09:30:00")).toEqual({ lastSeenAt: "2026-10-21T09:30:00" });
    expect(flagsCutoffParam({ lastSeenAt: null })).toBe("never");
    expect(parseFlagsCutoff("never")).toEqual({ lastSeenAt: null });
  });

  it.each([undefined, "", "yesterday", "2026-02-30T00:00:00", "2026-10-21T25:00:00", "2026-10-21 09:30:00", "2026-10-21T09:30:00Z"])(
    "treats %j as no cutoff, so the page starts a new visit",
    (value) => {
      expect(parseFlagsCutoff(value)).toBeNull();
    }
  );
});

describe("listFlags", () => {
  it("marks New against the visit's cutoff, not the viewer's current last-seen", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      /count\(\*\)/.test(sql) ? [{ count: 4 }] : [FLAG_ROW]
    );

    const page = await listFlags(ADMIN, { mentorUserId: 9001 }, { lastSeenAt: "2026-10-21T09:30:00" });

    const [listSql, listParams] = mockQuery.mock.calls.find(([sql]) => /FROM blended_learning_mentor_flags flag\s+JOIN/.test(sql))!;
    expect(listSql).toContain("flag.inserted_at > $1::timestamp");
    expect(listSql).not.toContain("blended_learning_flag_views");
    // An admin's feed is not narrowed to one Mentor's Students.
    expect(listParams).toEqual(["2026-10-21T09:30:00", 9001, null, null, 51, "2026-2027", false, null, null]);
    const [countSql, countParams] = mockQuery.mock.calls.find(([sql]) => /count\(\*\)/.test(sql))!;
    expect(countSql).not.toContain("blended_learning_flag_views");
    expect(countParams).toEqual(["2026-10-21T09:30:00", false, null, "2026-2027"]);
    expect(page?.newCount).toBe(4);
  });

  it("reports whether the flag's Student still has an active Mapping", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      /count\(\*\)/.test(sql) ? [{ count: 0 }] : [FLAG_ROW, { ...FLAG_ROW, id: 6, in_scope: true }]
    );

    const page = await listFlags(ADMIN, {}, { lastSeenAt: null });

    const [listSql] = mockQuery.mock.calls.find(([sql]) => /AS in_scope/.test(sql))!;
    expect(listSql).toContain(
      "mapping.academic_year = $6 AND mapping.started_at <= (now() AT TIME ZONE 'UTC') AND (mapping.ended_at IS NULL OR mapping.ended_at > (now() AT TIME ZONE 'UTC'))"
    );
    expect(page?.flags.map((flag) => [flag.id, flag.inScope])).toEqual([[7, false], [6, true]]);
  });
});

// A dropout's flags leave every feed, an admin's included, and every badge.
const NOT_A_DROPOUT =
  /^\s*(?:WHERE|AND) NOT EXISTS \(SELECT 1 FROM student dropout_student\s+WHERE dropout_student\.id = flag\.student_id AND dropout_student\.status = 'dropout'\) AND \(NOT \$\d::boolean OR/m;

describe("a dropout's flags", () => {
  it("are left out of an admin's feed and New count", async () => {
    mockQuery.mockImplementation(async (sql: string) => (/count\(\*\)/.test(sql) ? [{ count: 0 }] : []));

    await listFlags(ADMIN, {}, { lastSeenAt: null });

    const [listSql] = mockQuery.mock.calls.find(([sql]) => /AS in_scope/.test(sql))!;
    expect(listSql).toMatch(NOT_A_DROPOUT);
    const [countSql] = mockQuery.mock.calls.find(([sql]) => /count\(\*\)/.test(sql))!;
    expect(countSql).toMatch(NOT_A_DROPOUT);
  });

  it("give the admin's Mentor filter no option of their own", async () => {
    mockQuery.mockResolvedValue([{ mentor_user_id: "9001", mentor_name: "Synthetic Mentor" }]);

    expect(await listFlagMentors(ADMIN)).toEqual([{ mentorUserId: 9001, name: "Synthetic Mentor" }]);
    expect(mockQuery.mock.calls[0][0]).toMatch(
      /WHERE NOT EXISTS \(SELECT 1 FROM student dropout_student\s+WHERE dropout_student\.id = flag\.student_id AND dropout_student\.status = 'dropout'\)/
    );
  });

  it("are left out of the badge without a visit", async () => {
    mockQuery.mockResolvedValue([{ count: 0 }]);

    await countNewFlags(ADMIN);

    expect(mockQuery.mock.calls[0][0]).toMatch(NOT_A_DROPOUT);
  });
});

describe("countNewFlags", () => {
  it("without a visit, counts against the viewer's stored last-seen", async () => {
    mockQuery.mockResolvedValue([{ count: 2 }]);

    expect(await countNewFlags(ADMIN)).toBe(2);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("blended_learning_flag_views");
    expect(params).toEqual([ADMIN.actorEmail, false, null, "2026-2027"]);
  });
});

// A Mentor's Flags tab: only flags on Students with an active current-year
// Mapping to them, in every read, so another Mentor's flags never leave the DB.
const OWN_STUDENTS = /EXISTS \(\s*SELECT 1 FROM blended_learning_mentor_mentee_mappings own\s+WHERE own\.student_id = flag\.student_id AND own\.mentor_user_id = ANY\(\$(\d)::bigint\[\]\)\s+AND own\.academic_year = \$(\d) AND own\.started_at <= \(now\(\) AT TIME ZONE 'UTC'\) AND \(own\.ended_at IS NULL OR own\.ended_at > \(now\(\) AT TIME ZONE 'UTC'\)\) AND NOT EXISTS \(SELECT 1 FROM student dropout_student\s+WHERE dropout_student\.id = own\.student_id AND dropout_student\.status = 'dropout'\)\)/;

describe("a Mentor's flags", () => {
  it("narrows the feed to the Mentor's own Students and ignores a Mentor filter", async () => {
    mockQuery.mockImplementation(async (sql: string) => (/count\(\*\)/.test(sql) ? [{ count: 1 }] : [FLAG_ROW]));

    await listFlags(MENTOR, { mentorUserId: 9002, recipient: "maths" }, { lastSeenAt: null });

    const [listSql, listParams] = mockQuery.mock.calls.find(([sql]) => /AS in_scope/.test(sql))!;
    expect(listSql).toMatch(/NOT \$7::boolean OR EXISTS/);
    const [, mentorParam, yearParam] = OWN_STUDENTS.exec(listSql)!;
    expect(listParams![Number(mentorParam) - 1]).toEqual([9001]);
    expect(listParams![Number(yearParam) - 1]).toBe("2026-2027");
    expect(listParams).toEqual([null, null, "maths", null, 51, "2026-2027", true, [9001], null]);
    const [countSql, countParams] = mockQuery.mock.calls.find(([sql]) => /count\(\*\)/.test(sql))!;
    expect(countSql).toMatch(OWN_STUDENTS);
    expect(countParams).toEqual([null, true, [9001], "2026-2027"]);
  });

  it("counts only the Mentor's own Students' new flags for the badge", async () => {
    mockQuery.mockResolvedValue([{ count: 3 }]);

    expect(await countNewFlags(MENTOR)).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/NOT \$2::boolean OR EXISTS/);
    expect(sql).toMatch(OWN_STUDENTS);
    expect(params).toEqual([MENTOR.actorEmail, true, [9001], "2026-2027"]);
  });

  it("matches nothing for a Mentor without a user id, rather than every flag", async () => {
    mockQuery.mockResolvedValue([{ count: 0 }]);

    await countNewFlags({ ...MENTOR, mentorUserId: null });

    expect(mockQuery.mock.calls[0][1]).toEqual([MENTOR.actorEmail, true, [], "2026-2027"]);
  });

  it("offers a Mentor no Mentor filter, without querying other Mentors", async () => {
    expect(await listFlagMentors(MENTOR)).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// A team-lead Mentor (9001) who supervises Mentor 9002.
describe("a supervisor's flags", () => {
  const SUPERVISOR: BlendedLearningAccess = { ...MENTOR, supervisedMentorUserIds: [9002] };

  it("covers their own and the supervised Mentor's Students, in the feed and the badge", async () => {
    mockQuery.mockImplementation(async (sql: string) => (/count\(\*\)/.test(sql) ? [{ count: 2 }] : [FLAG_ROW]));

    await listFlags(SUPERVISOR, { recipient: null }, { lastSeenAt: null });

    const [listSql, listParams] = mockQuery.mock.calls.find(([sql]) => /AS in_scope/.test(sql))!;
    expect(listSql).toMatch(OWN_STUDENTS);
    expect(listParams).toEqual([null, null, null, null, 51, "2026-2027", true, [9001, 9002], null]);
    const [, countParams] = mockQuery.mock.calls.find(([sql]) => /count\(\*\)/.test(sql))!;
    expect(countParams).toEqual([null, true, [9001, 9002], "2026-2027"]);
  });

  it("filters by whose Student it is now (own or a supervised Mentor's), and ignores any other Mentor", async () => {
    mockQuery.mockImplementation(async (sql: string) => (/count\(\*\)/.test(sql) ? [{ count: 0 }] : []));
    const mentorParams = async (mentorUserId: number) => {
      mockQuery.mockClear();
      await listFlags(SUPERVISOR, { mentorUserId }, { lastSeenAt: null });
      const [, params] = mockQuery.mock.calls.find(([sql]) => /AS in_scope/.test(sql))!;
      // [the Conversation's Mentor, the Student's current Mentor]
      return [params![1], params![8]];
    };

    expect(await mentorParams(9002)).toEqual([null, 9002]);
    expect(await mentorParams(9001)).toEqual([null, 9001]);
    expect(await mentorParams(9003)).toEqual([null, null]);
  });

  it("matches the Mentor filter on the Student's active current-year Mapping, dropouts left out, not the flag's author", async () => {
    mockQuery.mockImplementation(async (sql: string) => (/count\(\*\)/.test(sql) ? [{ count: 0 }] : []));

    await listFlags(SUPERVISOR, { mentorUserId: 9001 }, { lastSeenAt: null });

    const [sql, params] = mockQuery.mock.calls.find(([text]) => /AS in_scope/.test(text))!;
    const filter = /\$9::bigint IS NULL OR EXISTS \(([\s\S]*?)\)\)\n/.exec(sql)![1];
    expect(filter).toContain("FROM blended_learning_mentor_mentee_mappings current_mapping");
    expect(filter).toContain("current_mapping.student_id = flag.student_id AND current_mapping.mentor_user_id = $9::bigint");
    expect(filter).toContain("current_mapping.started_at <= (now() AT TIME ZONE 'UTC') AND (current_mapping.ended_at IS NULL OR current_mapping.ended_at > (now() AT TIME ZONE 'UTC'))");
    expect(filter).toContain("dropout_student.status = 'dropout'");
    expect(params![1]).toBeNull();
  });
});

describe("an admin's Mentor filter", () => {
  it("still matches the Mentor who logged the flagged Conversation", async () => {
    mockQuery.mockImplementation(async (sql: string) => (/count\(\*\)/.test(sql) ? [{ count: 0 }] : []));

    await listFlags(ADMIN, { mentorUserId: 9002 }, { lastSeenAt: null });

    const [, params] = mockQuery.mock.calls.find(([sql]) => /AS in_scope/.test(sql))!;
    expect([params![1], params![8]]).toEqual([9002, null]);
  });
});
