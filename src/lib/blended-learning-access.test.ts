import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  canAccessBlendedStudent,
  canBlendedLearning,
  getBlendedLearningAccess,
  type BlendedLearningAccess,
  type BlendedLearningAction,
} from "./blended-learning-access";

const mockQuery = vi.mocked(query);

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
      actorUserId: 9001,
      mentorUserId: 9001,
    });
  });

  it("resolves a Mentor without a linked user_id through the user row matching their email, ignoring case", async () => {
    givenTables(
      { email: "Neha.Kashyap@avantifellows.org", level: 1, role: "blended_mentor", read_only: false, user_id: null },
      [{ id: 77, email: "neha.kashyap@AvantiFellows.org" }],
    );

    const access = await getBlendedLearningAccess("NEHA.kashyap@avantifellows.org");
    expect(access).toMatchObject({ kind: "mentor", actorUserId: 77, mentorUserId: 77 });
  });

  it("still resolves a Mentor with no user row, with no Mentor user id", async () => {
    givenTables({ email: "new.mentor@avantifellows.org", level: 1, role: "blended_mentor", read_only: false, user_id: null });

    const access = await getBlendedLearningAccess("new.mentor@avantifellows.org");
    expect(access).toMatchObject({ kind: "mentor", actorUserId: null, mentorUserId: null });
  });

  it("resolves a blended_admin as a Blended Learning Admin", async () => {
    givenTables({ email: "juned@avantifellows.org", level: 1, role: "blended_admin", read_only: false, user_id: 12 });

    expect(await getBlendedLearningAccess("juned@avantifellows.org")).toEqual({
      kind: "admin",
      role: "blended_admin",
      readOnly: false,
      actorEmail: "juned@avantifellows.org",
      actorUserId: 12,
    });
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
    actorEmail: "m@avantifellows.org", actorUserId: 1, mentorUserId: 1,
  };
  const admin: BlendedLearningAccess = {
    kind: "admin", role: "blended_admin", readOnly: false,
    actorEmail: "a@avantifellows.org", actorUserId: 2,
  };
  const readOnlyAdmin: BlendedLearningAccess = { ...admin, readOnly: true };

  // Rows: action → [Mentor, Admin, read-only Admin]
  const table: [BlendedLearningAction, boolean, boolean, boolean][] = [
    ["view_list", true, true, true],
    ["view_student", true, true, true],
    ["log", true, true, false],
    ["upload", true, true, false],
    ["manage_draft", true, true, false],
    ["play_recording", false, true, true],
    ["view_flags", false, true, true],
    ["view_mentors", false, true, true],
  ];

  it.each(table)("%s: Mentor %s, Admin %s, read-only Admin %s", (action, forMentor, forAdmin, forReadOnly) => {
    expect(canBlendedLearning(mentor, action)).toBe(forMentor);
    expect(canBlendedLearning(admin, action)).toBe(forAdmin);
    expect(canBlendedLearning(readOnlyAdmin, action)).toBe(forReadOnly);
  });

  it("refuses every action without access", () => {
    expect(canBlendedLearning(null, "view_list")).toBe(false);
  });
});

describe("canAccessBlendedStudent", () => {
  const mentor: BlendedLearningAccess = {
    kind: "mentor", role: "blended_mentor", readOnly: false,
    actorEmail: "faizan@avantifellows.org", actorUserId: 9001, mentorUserId: 9001,
  };
  const readOnlyAdmin: BlendedLearningAccess = {
    kind: "admin", role: "blended_admin", readOnly: true,
    actorEmail: "shalinijha@avantifellows.org", actorUserId: 13,
  };

  // Fixture: the active current-year Mapping per Student (what the SQL returns).
  function givenActiveMappings(mappings: { student_id: number; mentor_user_id: number }[]) {
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (!sql.includes("blended_learning_mentor_mentee_mappings")) return [];
      return mappings.filter((m) => m.student_id === Number(params?.[0]));
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

  it("refuses a Mentor with no Mentor user id, an invalid Student id and no access, without reading", async () => {
    givenActiveMappings([{ student_id: 501, mentor_user_id: 9001 }]);
    expect(await canAccessBlendedStudent({ ...mentor, mentorUserId: null }, 501)).toBe(false);
    expect(await canAccessBlendedStudent(mentor, Number.NaN)).toBe(false);
    expect(await canAccessBlendedStudent(mentor, 0)).toBe(false);
    expect(await canAccessBlendedStudent(null, 501)).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
