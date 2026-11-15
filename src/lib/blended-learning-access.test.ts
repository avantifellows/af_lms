import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import type { PoolClient } from "pg";
import {
  activeBlendedMappingSql,
  blendedStudentScope,
  canAccessBlendedStudent,
  canBlendedLearning,
  canViewBlendedStudent,
  currentBlendedMappingRowSql,
  getBlendedLearningAccess,
  isTeamLead,
  lockMappingInScope,
  notBlendedDropoutSql,
  supervisedMentor,
  viewableMentorUserIds,
  type BlendedLearningAccess,
  type BlendedLearningAction,
} from "./blended-learning-access";

const mockQuery = vi.mocked(query);

// What the scope SQL adds to leave dropouts out.
const DROPOUT_PREDICATE = "dropout_student.status = 'dropout'";
// What it adds, per alias, to keep only rows whose period [started_at,
// ended_at) contains now (UTC).
const periodPredicate = (alias: string) =>
  `${alias}.started_at <= (now() AT TIME ZONE 'UTC') AND (${alias}.ended_at IS NULL OR ${alias}.ended_at > (now() AT TIME ZONE 'UTC'))`;
// The fixtures' "now", a time before it (the default started_at) and one
// after it: a future started_at from the import sheet, or a future ended_at
// from a reassignment that hands over at the new Mapping's start.
const NOW = "2026-11-23T00:00:00Z";
const EARLIER = "2026-06-01T00:00:00Z";
const LATER = "2099-01-01T00:00:00Z";
type Period = { started_at?: string; ended_at?: string | null };
// The fixture row's period contains NOW (ISO strings compare in time order).
function containsNow({ started_at = EARLIER, ended_at = null }: Period): boolean {
  return started_at <= NOW && (ended_at == null || ended_at > NOW);
}

type Row = {
  email: string;
  level: number;
  role: string;
  read_only: boolean;
  user_id: number | null;
};

type Supervision = {
  supervisor_user_id: number;
  mentor_user_id: number;
  academic_year: string;
  ended_at?: string | null;
  started_at?: string;
};

// Fixture tables: one live user_permission row, the `user` table, the
// Supervisions (started EARLIER and not ended unless set) and the `user` ids
// that hold a live blended_mentor permission (by default every supervised
// Mentor). The Supervisions read applies the statement's own predicates: the
// year, the period containing NOW, and the live-permission check when the SQL
// has them.
function givenTables(
  permission: Row | null,
  users: { id: number; email: string }[] = [],
  supervisions: Supervision[] = [],
  liveMentorUserIds: number[] = supervisions.map((row) => row.mentor_user_id)
) {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM blended_learning_mentor_supervisions")) {
      const currentOnly = sql.includes(periodPredicate("supervision"));
      const liveOnly = sql.includes("FROM user_permission live_permission") && params?.[2] === "blended_mentor";
      return supervisions
        .filter((row) => row.supervisor_user_id === params?.[0] && row.academic_year === params?.[1])
        .filter((row) => !currentOnly || containsNow(row))
        .filter((row) => !liveOnly || liveMentorUserIds.includes(row.mentor_user_id))
        .map((row) => ({ mentor_user_id: String(row.mentor_user_id) }));
    }
    if (sql.includes("FROM user_permission")) return permission ? [{
      school_codes: null,
      regions: null,
      program_ids: [],
      ...permission,
    }] : [];
    if (sql.includes('FROM "user"')) {
      const email = String(params?.[0] ?? "").toLowerCase();
      return users.filter((u) => u.email.toLowerCase() === email).map((u) => ({ id: u.id }));
    }
    return [];
  });
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getBlendedLearningAccess", () => {
  it("resolves a Mentor through user_permission.user_id", async () => {
    givenTables({ email: "faizan@avantifellows.org", level: 1, role: "blended_mentor", read_only: false, user_id: 9001 });

    expect(await getBlendedLearningAccess("faizan@avantifellows.org")).toEqual({
      kind: "mentor",
      role: "blended_mentor",
      readOnly: false,
      actorEmail: "faizan@avantifellows.org",
      mentorUserId: 9001,
      supervisedMentorUserIds: [],
    });
  });

  it("gives a supervisor the Mentors of their active current-year Supervisions only", async () => {
    givenTables(
      { email: "lead@test.local", level: 1, role: "blended_mentor", read_only: false, user_id: 9001 },
      [],
      [
        { supervisor_user_id: 9001, mentor_user_id: 9004, academic_year: CURRENT_ACADEMIC_YEAR },
        { supervisor_user_id: 9001, mentor_user_id: 9002, academic_year: CURRENT_ACADEMIC_YEAR },
        { supervisor_user_id: 9001, mentor_user_id: 9003, academic_year: "2025-2026" },
        { supervisor_user_id: 9005, mentor_user_id: 9006, academic_year: CURRENT_ACADEMIC_YEAR },
      ],
    );

    expect(await getBlendedLearningAccess("lead@test.local")).toMatchObject({
      kind: "mentor",
      mentorUserId: 9001,
      supervisedMentorUserIds: [9004, 9002],
    });
    const [sql] = mockQuery.mock.calls.find(([text]) => text.includes("blended_learning_mentor_supervisions"))!;
    expect(sql).toContain(periodPredicate("supervision"));
    // A Supervision has no Student, so the Mapping's dropout filter is not on it.
    expect(sql).not.toContain(DROPOUT_PREDICATE);
    expect(sql).not.toContain("supervision.student_id");
  });

  it("grants nothing through an ended Supervision", async () => {
    givenTables(
      { email: "lead@test.local", level: 1, role: "blended_mentor", read_only: false, user_id: 9001 },
      [],
      [
        { supervisor_user_id: 9001, mentor_user_id: 9002, academic_year: CURRENT_ACADEMIC_YEAR, ended_at: "2026-11-15T00:00:00Z" },
        { supervisor_user_id: 9001, mentor_user_id: 9004, academic_year: CURRENT_ACADEMIC_YEAR, ended_at: null },
      ],
    );

    const access = await getBlendedLearningAccess("lead@test.local");
    expect(access).toMatchObject({ supervisedMentorUserIds: [9004] });
    expect(supervisedMentor(access!, 9002)).toBeNull();
    expect(viewableMentorUserIds(access!)).toEqual([9001, 9004]);
  });

  it("grants nothing through a Supervision that starts later, until it starts", async () => {
    givenTables(
      { email: "lead@test.local", level: 1, role: "blended_mentor", read_only: false, user_id: 9001 },
      [],
      [
        { supervisor_user_id: 9001, mentor_user_id: 9002, academic_year: CURRENT_ACADEMIC_YEAR, started_at: LATER },
        { supervisor_user_id: 9001, mentor_user_id: 9004, academic_year: CURRENT_ACADEMIC_YEAR },
      ],
    );

    const access = await getBlendedLearningAccess("lead@test.local");
    expect(access).toMatchObject({ supervisedMentorUserIds: [9004] });
    expect(supervisedMentor(access!, 9002)).toBeNull();
    expect(viewableMentorUserIds(access!)).toEqual([9001, 9004]);
  });

  it("keeps a Supervision ended in the future in force until its end", async () => {
    givenTables(
      { email: "lead@test.local", level: 1, role: "blended_mentor", read_only: false, user_id: 9001 },
      [],
      [
        { supervisor_user_id: 9001, mentor_user_id: 9002, academic_year: CURRENT_ACADEMIC_YEAR, ended_at: LATER },
        { supervisor_user_id: 9001, mentor_user_id: 9004, academic_year: CURRENT_ACADEMIC_YEAR, started_at: EARLIER, ended_at: EARLIER },
      ],
    );

    const access = await getBlendedLearningAccess("lead@test.local");
    // 9004's row is zero-length (ended_at = started_at): it contains no instant.
    expect(access).toMatchObject({ supervisedMentorUserIds: [9002] });
    expect(isTeamLead(access!)).toBe(true);
  });

  it("does not make a Mentor a team lead through a Supervision that starts later", async () => {
    givenTables(
      { email: "lead@test.local", level: 1, role: "blended_mentor", read_only: false, user_id: 9001 },
      [],
      [{ supervisor_user_id: 9001, mentor_user_id: 9002, academic_year: CURRENT_ACADEMIC_YEAR, started_at: LATER }],
    );

    const access = await getBlendedLearningAccess("lead@test.local");
    expect(access).toMatchObject({ supervisedMentorUserIds: [] });
    expect(isTeamLead(access!)).toBe(false);
  });

  it("drops a reportee who no longer holds a live blended_mentor permission", async () => {
    givenTables(
      { email: "lead@test.local", level: 1, role: "blended_mentor", read_only: false, user_id: 9001 },
      [],
      [
        { supervisor_user_id: 9001, mentor_user_id: 9002, academic_year: CURRENT_ACADEMIC_YEAR },
        { supervisor_user_id: 9001, mentor_user_id: 9004, academic_year: CURRENT_ACADEMIC_YEAR },
      ],
      [9004],
    );

    const access = await getBlendedLearningAccess("lead@test.local");
    expect(access).toMatchObject({ supervisedMentorUserIds: [9004] });
    expect(viewableMentorUserIds(access!)).toEqual([9001, 9004]);
  });

  it("reads no Supervisions for a Mentor with no user id, or for an admin", async () => {
    givenTables({ email: "new.mentor@test.local", level: 1, role: "blended_mentor", read_only: false, user_id: null });
    expect(await getBlendedLearningAccess("new.mentor@test.local")).toMatchObject({ supervisedMentorUserIds: [] });

    givenTables({ email: "bl.admin@test.local", level: 1, role: "blended_admin", read_only: false, user_id: 9001 });
    expect(await getBlendedLearningAccess("bl.admin@test.local")).not.toHaveProperty("supervisedMentorUserIds");
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes("blended_learning_mentor_supervisions"))).toBe(false);
  });

  it("resolves a Mentor without a linked user_id through the user row matching their email, ignoring case", async () => {
    givenTables(
      { email: "Neha.Kashyap@avantifellows.org", level: 1, role: "blended_mentor", read_only: false, user_id: null },
      [{ id: 77, email: "neha.kashyap@AvantiFellows.org" }],
    );

    const access = await getBlendedLearningAccess("NEHA.kashyap@avantifellows.org");
    expect(access).toMatchObject({ kind: "mentor", mentorUserId: 77 });
  });

  it("still resolves a Mentor with no user row, with no Mentor user id", async () => {
    givenTables({ email: "new.mentor@avantifellows.org", level: 1, role: "blended_mentor", read_only: false, user_id: null });

    const access = await getBlendedLearningAccess("new.mentor@avantifellows.org");
    expect(access).toMatchObject({ kind: "mentor", mentorUserId: null });
  });

  it("resolves a blended_admin as a Blended Learning Admin, with no user lookup", async () => {
    givenTables({ email: "juned@avantifellows.org", level: 1, role: "blended_admin", read_only: false, user_id: null });

    expect(await getBlendedLearningAccess("juned@avantifellows.org")).toEqual({
      kind: "admin",
      role: "blended_admin",
      readOnly: false,
      actorEmail: "juned@avantifellows.org",
    });
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('FROM "user"'))).toBe(false);
  });

  it("resolves a read-only blended_admin as a read-only Blended Learning Admin", async () => {
    givenTables({ email: "shalinijha@avantifellows.org", level: 1, role: "blended_admin", read_only: true, user_id: 13 });

    expect(await getBlendedLearningAccess("shalinijha@avantifellows.org")).toMatchObject({
      kind: "admin",
      readOnly: true,
    });
  });

  it("resolves an LMS admin as a Blended Learning Admin", async () => {
    givenTables({ email: "panchali@avantifellows.org", level: 3, role: "admin", read_only: false, user_id: 14 });

    expect(await getBlendedLearningAccess("panchali@avantifellows.org")).toMatchObject({
      kind: "admin",
      role: "admin",
      readOnly: false,
    });
  });

  it.each(["teacher", "program_manager", "program_admin", "holistic_mentorship_admin", "pmu_manager", "pmu_govt_school_user"])(
    "denies a %s",
    async (role) => {
      givenTables({ email: "someone@avantifellows.org", level: 3, role, read_only: false, user_id: 15 });
      expect(await getBlendedLearningAccess("someone@avantifellows.org")).toBeNull();
    },
  );

  it("denies a person with no live permission row, and a signed-out caller", async () => {
    givenTables(null);
    expect(await getBlendedLearningAccess("stranger@avantifellows.org")).toBeNull();
    expect(await getBlendedLearningAccess(null)).toBeNull();
    expect(await getBlendedLearningAccess(undefined)).toBeNull();
  });
});

describe("canBlendedLearning", () => {
  const mentor: BlendedLearningAccess = {
    kind: "mentor", role: "blended_mentor", readOnly: false,
    actorEmail: "m@avantifellows.org", mentorUserId: 1,
  };
  const admin: BlendedLearningAccess = {
    kind: "admin", role: "blended_admin", readOnly: false,
    actorEmail: "a@avantifellows.org",
  };
  const readOnlyAdmin: BlendedLearningAccess = { ...admin, readOnly: true };
  const lmsAdmin: BlendedLearningAccess = { ...admin, role: "admin" };
  const readOnlyMentor: BlendedLearningAccess = { ...mentor, readOnly: true };

  // Rows: action → [Mentor, Admin, read-only Admin]. Only a Mentor mutates
  // Mentee records; an admin only manages Resources and Common Action Items.
  const table: [BlendedLearningAction, boolean, boolean, boolean][] = [
    ["view_list", true, true, true],
    ["view_student", true, true, true],
    ["log", true, false, false],
    ["upload", true, false, false],
    ["manage_draft", true, false, false],
    ["play_recording", false, true, true],
    // A Mentor's flags are scoped to their own Students (blended-learning-flags).
    ["view_flags", true, true, true],
    ["view_mentors", false, true, true],
    // Resources and Common Action Items: the one thing an admin edits.
    ["manage", false, true, false],
    // The JEE form: the Mentor or an admin, never read-only.
    ["record_jee_form", true, true, false],
  ];

  it.each(table)("%s: Mentor %s, Admin %s, read-only Admin %s", (action, forMentor, forAdmin, forReadOnly) => {
    expect(canBlendedLearning(mentor, action)).toBe(forMentor);
    expect(canBlendedLearning(admin, action)).toBe(forAdmin);
    expect(canBlendedLearning(lmsAdmin, action)).toBe(forAdmin);
    expect(canBlendedLearning(readOnlyAdmin, action)).toBe(forReadOnly);
  });

  it.each(["log", "upload", "manage_draft", "manage", "record_jee_form"] as const)("refuses a read-only Mentor %s", (action) => {
    expect(canBlendedLearning(readOnlyMentor, action)).toBe(false);
    expect(canBlendedLearning(readOnlyMentor, "view_student")).toBe(true);
  });

  it("refuses every action without access", () => {
    expect(canBlendedLearning(null, "view_list")).toBe(false);
  });
});

describe("canAccessBlendedStudent", () => {
  const mentor: BlendedLearningAccess = {
    kind: "mentor", role: "blended_mentor", readOnly: false,
    actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
  };
  const readOnlyAdmin: BlendedLearningAccess = {
    kind: "admin", role: "blended_admin", readOnly: true,
    actorEmail: "shalinijha@avantifellows.org",
  };

  // Fixture: current-year Mapping rows per Student, each Student's status
  // (omitted: NULL) and the row's period (omitted: started EARLIER, not
  // ended). The SQL's dropout and period predicates are applied when present.
  function givenActiveMappings(
    mappings: ({ student_id: number; mentor_user_id: number; status?: string | null } & Period)[]
  ) {
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (!sql.includes("blended_learning_mentor_mentee_mappings")) return [];
      const dropoutsHidden = sql.includes(DROPOUT_PREDICATE);
      const currentOnly = sql.includes(periodPredicate("mapping"));
      return mappings
        .filter((m) => m.student_id === Number(params?.[0]))
        .filter((m) => !dropoutsHidden || m.status !== "dropout")
        .filter((m) => !currentOnly || containsNow(m))
        .map(({ mentor_user_id }) => ({ mentor_user_id }));
    });
  }

  it("lets a Mentor reach a Student mapped to them", async () => {
    givenActiveMappings([{ student_id: 501, mentor_user_id: 9001 }]);
    expect(await canAccessBlendedStudent(mentor, 501)).toBe(true);
  });

  it("refuses a Mentor a Student mapped to another Mentor", async () => {
    givenActiveMappings([{ student_id: 502, mentor_user_id: 9002 }]);
    expect(await canAccessBlendedStudent(mentor, 502)).toBe(false);
  });

  it("lets a Blended Learning Admin, even read-only, reach any mapped Student", async () => {
    givenActiveMappings([{ student_id: 502, mentor_user_id: 9002 }]);
    expect(await canAccessBlendedStudent(readOnlyAdmin, 502)).toBe(true);
  });

  it("refuses everyone a Student with no active current-year Mapping", async () => {
    givenActiveMappings([]);
    expect(await canAccessBlendedStudent(mentor, 503)).toBe(false);
    expect(await canAccessBlendedStudent(readOnlyAdmin, 503)).toBe(false);
  });

  it("refuses everyone a Student marked a dropout, though their Mapping is still active", async () => {
    givenActiveMappings([{ student_id: 504, mentor_user_id: 9001, status: "dropout" }]);
    expect(await canAccessBlendedStudent(mentor, 504)).toBe(false);
    expect(await canAccessBlendedStudent(readOnlyAdmin, 504)).toBe(false);
  });

  it("refuses everyone a Student whose Mapping starts later, until it starts", async () => {
    givenActiveMappings([{ student_id: 507, mentor_user_id: 9001, started_at: LATER }]);
    expect(await canAccessBlendedStudent(mentor, 507)).toBe(false);
    expect(await canViewBlendedStudent(mentor, 507)).toBe(false);
    expect(await canAccessBlendedStudent(readOnlyAdmin, 507)).toBe(false);
  });

  it("keeps a reassigned Student with the old Mentor until the new Mapping starts", async () => {
    // db-service ends the old Mapping at the new one's started_at, here later.
    givenActiveMappings([
      { student_id: 508, mentor_user_id: 9001, ended_at: LATER },
      { student_id: 508, mentor_user_id: 9002, started_at: LATER },
    ]);
    const newMentor: BlendedLearningAccess = { ...mentor, actorEmail: "new.mentor@test.local", mentorUserId: 9002 };
    expect(await canAccessBlendedStudent(mentor, 508)).toBe(true);
    expect(await canAccessBlendedStudent(newMentor, 508)).toBe(false);
    expect(await canViewBlendedStudent(newMentor, 508)).toBe(false);
    expect(await canAccessBlendedStudent(readOnlyAdmin, 508)).toBe(true);
  });

  it("refuses everyone a Student whose only Mapping ended, or ended as it started", async () => {
    givenActiveMappings([
      { student_id: 509, mentor_user_id: 9001, ended_at: EARLIER },
      { student_id: 510, mentor_user_id: 9001, started_at: EARLIER, ended_at: EARLIER },
    ]);
    for (const studentId of [509, 510]) {
      expect(await canAccessBlendedStudent(mentor, studentId)).toBe(false);
      expect(await canAccessBlendedStudent(readOnlyAdmin, studentId)).toBe(false);
    }
  });

  it("still lets everyone reach a Student with no status or another status", async () => {
    givenActiveMappings([
      { student_id: 505, mentor_user_id: 9001, status: null },
      { student_id: 506, mentor_user_id: 9001, status: "enrolled" },
    ]);
    for (const studentId of [505, 506]) {
      expect(await canAccessBlendedStudent(mentor, studentId)).toBe(true);
      expect(await canAccessBlendedStudent(readOnlyAdmin, studentId)).toBe(true);
    }
  });

  it("refuses a Mentor with no Mentor user id, an invalid Student id and no access, without reading", async () => {
    givenActiveMappings([{ student_id: 501, mentor_user_id: 9001 }]);
    expect(await canAccessBlendedStudent({ ...mentor, mentorUserId: null }, 501)).toBe(false);
    expect(await canAccessBlendedStudent(mentor, Number.NaN)).toBe(false);
    expect(await canAccessBlendedStudent(mentor, 0)).toBe(false);
    expect(await canAccessBlendedStudent(null, 501)).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("the Mapping source SQL", () => {
  it("is a current-year Mapping whose period contains now and whose Student is not marked a dropout", () => {
    const sql = activeBlendedMappingSql("mapping", "$2");
    expect(sql).toContain(`mapping.academic_year = $2 AND ${periodPredicate("mapping")}`);
    expect(sql).toContain(notBlendedDropoutSql("mapping.student_id"));
    // Half-open: a row ends at ended_at, so a zero-length row contains nothing.
    expect(sql).toContain("mapping.ended_at > (now() AT TIME ZONE 'UTC')");
    expect(sql).not.toContain("ended_at >=");
  });

  it("leaves out only status 'dropout', so a NULL status stays in", () => {
    // NOT EXISTS over `status = 'dropout'`: a NULL status never matches the
    // inner row, so the Student stays. A `status <> 'dropout'` test would drop NULLs.
    expect(notBlendedDropoutSql("own.student_id")).toMatch(
      /^NOT EXISTS \(SELECT 1 FROM student dropout_student\s+WHERE dropout_student\.id = own\.student_id AND dropout_student\.status = 'dropout'\)$/
    );
    expect(notBlendedDropoutSql("own.student_id")).not.toMatch(/<>|!=|IS DISTINCT/);
  });

  it("keeps the stored Mapping rows not yet ended, dropouts, later starts and future ends included, for operator data loads", () => {
    expect(currentBlendedMappingRowSql("mapping", "$1")).toBe(
      "mapping.academic_year = $1 AND (mapping.ended_at IS NULL OR mapping.ended_at > (now() AT TIME ZONE 'UTC'))"
    );
  });
});

describe("lockMappingInScope", () => {
  const mentor: BlendedLearningAccess = {
    kind: "mentor", role: "blended_mentor", readOnly: false,
    actorEmail: "mentor@test.local", mentorUserId: 9001,
  };
  const mapping = { mentor_user_id: 9001, program_id: 80, academic_year: "2026-2027" };

  it("locks the Mapping only when the Student is not a dropout", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [mapping] });
    expect(await lockMappingInScope({ query: clientQuery } as never, mentor, 501)).toEqual(mapping);
    const [sql, params] = clientQuery.mock.calls[0];
    expect(sql).toContain(DROPOUT_PREDICATE);
    expect(sql).toContain(periodPredicate("mapping"));
    expect(sql).toMatch(/FOR SHARE$/);
    expect(params).toEqual([501, "2026-2027"]);
  });

  it("is null when the scoped read finds no Mapping, as for a dropout", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    expect(await lockMappingInScope({ query: clientQuery } as never, mentor, 504)).toBeNull();
  });
});

// A team-lead Mentor (9001) who supervises Mentor 9002. Students: 501 is the
// supervisor's own, 502 is 9002's (a reportee's), 503 is 9003's (not a
// reportee's), 504 has no active Mapping.
describe("the supervisor access matrix", () => {
  const supervisor: BlendedLearningAccess = {
    kind: "mentor", role: "blended_mentor", readOnly: false,
    actorEmail: "lead@test.local", mentorUserId: 9001, supervisedMentorUserIds: [9002],
  };
  const reportee: BlendedLearningAccess = {
    kind: "mentor", role: "blended_mentor", readOnly: false,
    actorEmail: "reportee@test.local", mentorUserId: 9002, supervisedMentorUserIds: [],
  };
  const admin: BlendedLearningAccess = {
    kind: "admin", role: "blended_admin", readOnly: true, actorEmail: "viewer@test.local",
  };
  const MAPPINGS: Record<number, number> = { 501: 9001, 502: 9002, 503: 9003 };

  beforeEach(() => {
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (!sql.includes("blended_learning_mentor_mentee_mappings")) return [];
      const mentor = MAPPINGS[Number(params?.[0])];
      return mentor ? [{ mentor_user_id: String(mentor) }] : [];
    });
  });

  // Rows: Student → [scope, can view, can write (full scope)].
  const table: [string, number, "full" | "view_only" | null][] = [
    ["their own Mentee", 501, "full"],
    ["a reportee's Mentee, view only", 502, "view_only"],
    ["a Mentee of a Mentor they don't supervise: nothing", 503, null],
    ["an unmapped Student: nothing", 504, null],
  ];

  it.each(table)("a supervisor reaches %s", async (_case, studentId, scope) => {
    expect(await blendedStudentScope(supervisor, studentId)).toBe(scope);
    expect(await canViewBlendedStudent(supervisor, studentId)).toBe(scope !== null);
    expect(await canAccessBlendedStudent(supervisor, studentId)).toBe(scope === "full");
  });

  it("reads the Mapping without dropouts, so a reportee's dropout is out of the supervisor's scope", async () => {
    // 505 is a reportee's Mentee marked a dropout: the scoped read finds no Mapping.
    expect(await blendedStudentScope(supervisor, 505)).toBeNull();
    expect(await canViewBlendedStudent(supervisor, 505)).toBe(false);
    const [sql, params] = mockQuery.mock.calls.at(-1)!;
    expect(sql).toContain(DROPOUT_PREDICATE);
    expect(params).toEqual([505, CURRENT_ACADEMIC_YEAR]);
  });

  it("gives the reportee full scope on their own Mentee and none on their supervisor's", async () => {
    expect(await blendedStudentScope(reportee, 502)).toBe("full");
    expect(await blendedStudentScope(reportee, 501)).toBeNull();
  });

  it("keeps a Blended Learning Admin's full reach on every mapped Student", async () => {
    for (const studentId of [501, 502, 503]) expect(await blendedStudentScope(admin, studentId)).toBe("full");
    expect(await blendedStudentScope(admin, 504)).toBeNull();
  });

  it("never locks a reportee's Mentee's Mapping for a supervisor's write", async () => {
    const client = {
      query: vi.fn(async (_sql: string, params: unknown[]) => ({
        rows: MAPPINGS[Number(params[0])]
          ? [{ mentor_user_id: String(MAPPINGS[Number(params[0])]), program_id: "80", academic_year: CURRENT_ACADEMIC_YEAR }]
          : [],
      })),
    } as unknown as PoolClient;

    expect(await lockMappingInScope(client, supervisor, 502)).toBeNull();
    expect(await lockMappingInScope(client, supervisor, 503)).toBeNull();
    expect(await lockMappingInScope(client, supervisor, 501)).toMatchObject({ mentor_user_id: "9001" });
    expect(await lockMappingInScope(client, reportee, 502)).toMatchObject({ mentor_user_id: "9002" });
  });

  it("leaves a supervisor's actions a Mentor's: no recordings, Mentor cards or Manage", () => {
    for (const action of ["play_recording", "view_mentors", "manage"] as const) {
      expect(canBlendedLearning(supervisor, action)).toBe(false);
    }
  });

  it("lists the Mentors whose Students each viewer sees", () => {
    expect(viewableMentorUserIds(supervisor)).toEqual([9001, 9002]);
    expect(viewableMentorUserIds(reportee)).toEqual([9002]);
    expect(viewableMentorUserIds({ ...supervisor, mentorUserId: null })).toEqual([]);
    expect(viewableMentorUserIds(admin)).toBeNull();
  });

  it("accepts only a supervised Mentor as the Mentor to view", () => {
    expect(supervisedMentor(supervisor, 9002)).toBe(9002);
    expect(supervisedMentor(supervisor, 9001)).toBeNull();
    expect(supervisedMentor(supervisor, 9003)).toBeNull();
    expect(supervisedMentor(supervisor, null)).toBeNull();
    expect(supervisedMentor(admin, 9002)).toBeNull();
  });
});
