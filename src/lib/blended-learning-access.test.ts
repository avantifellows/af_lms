import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  activeBlendedMappingSql,
  canAccessBlendedStudent,
  canBlendedLearning,
  currentBlendedMappingRowSql,
  getBlendedLearningAccess,
  lockMappingInScope,
  notBlendedDropoutSql,
  type BlendedLearningAccess,
  type BlendedLearningAction,
} from "./blended-learning-access";

const mockQuery = vi.mocked(query);

// What the scope SQL adds to leave dropouts out.
const DROPOUT_PREDICATE = "dropout_student.status = 'dropout'";

type Row = {
  email: string;
  level: number;
  role: string;
  read_only: boolean;
  user_id: number | null;
};

// Fixture tables: one live user_permission row and the `user` table.
function givenTables(permission: Row | null, users: { id: number; email: string }[] = []) {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
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
    });
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
  ];

  it.each(table)("%s: Mentor %s, Admin %s, read-only Admin %s", (action, forMentor, forAdmin, forReadOnly) => {
    expect(canBlendedLearning(mentor, action)).toBe(forMentor);
    expect(canBlendedLearning(admin, action)).toBe(forAdmin);
    expect(canBlendedLearning(lmsAdmin, action)).toBe(forAdmin);
    expect(canBlendedLearning(readOnlyAdmin, action)).toBe(forReadOnly);
  });

  it.each(["log", "upload", "manage_draft", "manage"] as const)("refuses a read-only Mentor %s", (action) => {
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

  // Fixture: the active current-year Mapping per Student, and each Student's
  // status (omitted: NULL). The SQL's dropout predicate is applied when present.
  function givenActiveMappings(mappings: { student_id: number; mentor_user_id: number; status?: string | null }[]) {
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (!sql.includes("blended_learning_mentor_mentee_mappings")) return [];
      const dropoutsHidden = sql.includes(DROPOUT_PREDICATE);
      return mappings
        .filter((m) => m.student_id === Number(params?.[0]))
        .filter((m) => !dropoutsHidden || m.status !== "dropout")
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
  it("is an active current-year Mapping whose Student is not marked a dropout", () => {
    const sql = activeBlendedMappingSql("mapping", "$2");
    expect(sql).toContain("mapping.academic_year = $2 AND mapping.ended_at IS NULL");
    expect(sql).toContain(notBlendedDropoutSql("mapping.student_id"));
  });

  it("leaves out only status 'dropout', so a NULL status stays in", () => {
    // NOT EXISTS over `status = 'dropout'`: a NULL status never matches the
    // inner row, so the Student stays. A `status <> 'dropout'` test would drop NULLs.
    expect(notBlendedDropoutSql("own.student_id")).toMatch(
      /^NOT EXISTS \(SELECT 1 FROM student dropout_student\s+WHERE dropout_student\.id = own\.student_id AND dropout_student\.status = 'dropout'\)$/
    );
    expect(notBlendedDropoutSql("own.student_id")).not.toMatch(/<>|!=|IS DISTINCT/);
  });

  it("keeps the stored Mapping rows, dropouts included, for operator data loads", () => {
    expect(currentBlendedMappingRowSql("mapping", "$1")).toBe("mapping.academic_year = $1 AND mapping.ended_at IS NULL");
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
    expect(sql).toMatch(/FOR SHARE$/);
    expect(params).toEqual([501, "2026-2027"]);
  });

  it("is null when the scoped read finds no Mapping, as for a dropout", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    expect(await lockMappingInScope({ query: clientQuery } as never, mentor, 504)).toBeNull();
  });
});
