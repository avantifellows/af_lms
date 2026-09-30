import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./permissions")>();
  return { ...actual, getResolvedPermission: vi.fn() };
});
vi.mock("./school-students", () => ({ getSchoolRoster: vi.fn() }));

import { query } from "./db";
import { getResolvedPermission, type UserPermission } from "./permissions";
import { getSchoolRoster } from "./school-students";
import type { Student } from "@/components/StudentTable";
import {
  InterventionFlagError,
  addFlagUpdate,
  authorizeInterventionFlags,
  flagStudentScopeForPmu,
  interventionFlagAccess,
  listSchoolFlags,
  mayRaiseFlagForPmu,
  mayUpdateFlagForPmu,
  raiseFlag,
  validateNote,
  type InterventionFlagActor,
} from "./intervention-flags";

const mockQuery = vi.mocked(query);
const mockGetResolvedPermission = vi.mocked(getResolvedPermission);

const TEACHER: UserPermission = {
  email: "teacher@avantifellows.org",
  level: 1,
  role: "teacher",
  school_codes: ["70705"],
  program_ids: [1],
  read_only: false,
  user_id: 42,
};
const PMU_MANAGER: UserPermission = {
  email: "pmu@avantifellows.org",
  level: 3,
  role: "pmu_manager",
  program_ids: [64],
  read_only: false,
  user_id: 77,
};
const SCHOOL = {
  id: "7", code: "70705", udise_code: "09123", name: "JNV Test", region: "North", af_school_category: "JNV",
};
const NON_JNV_SCHOOL = { ...SCHOOL, code: "80808", udise_code: "08888", name: "Govt School", af_school_category: "Govt" };
const SESSION = { user: { email: TEACHER.email } };
const PMU_SESSION = { user: { email: PMU_MANAGER.email } };
const ACTOR: InterventionFlagActor = { email: "Teacher@AvantiFellows.org", userId: 42, permission: TEACHER };
const PMU_ACTOR: InterventionFlagActor = { email: PMU_MANAGER.email, userId: 77, permission: PMU_MANAGER };

function rosterStudent(pk: string | null, overrides: Partial<Student>): Student {
  return {
    student_pk_id: pk, program_id: null, student_program_ids: [], dropout_program_ids: [], status: null,
    ...overrides,
  } as Student;
}

function fakeClient(results: Array<{ rows: unknown[] } | Error>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const next = results.shift() ?? { rows: [] };
      if (next instanceof Error) throw next;
      return next;
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

beforeEach(() => vi.resetAllMocks());

describe("authorizeInterventionFlags", () => {
  it("rejects a missing session", async () => {
    const result = await authorizeInterventionFlags(null, "70705", "view");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects users without a permission row", async () => {
    mockGetResolvedPermission.mockResolvedValue(null);
    const result = await authorizeInterventionFlags(SESSION, "70705", "view");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns 404 for an unknown school", async () => {
    mockGetResolvedPermission.mockResolvedValue(TEACHER);
    mockQuery.mockResolvedValueOnce([]);
    const result = await authorizeInterventionFlags(SESSION, "99999", "view");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("rejects a school outside the user's scope", async () => {
    mockGetResolvedPermission.mockResolvedValue(TEACHER);
    mockQuery.mockResolvedValueOnce([{ ...SCHOOL, code: "11111" }]);
    const result = await authorizeInterventionFlags(SESSION, "11111", "view");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("lets read-only users view but not change flags", async () => {
    mockGetResolvedPermission.mockResolvedValue({ ...TEACHER, read_only: true });
    mockQuery.mockResolvedValueOnce([SCHOOL]);
    expect((await authorizeInterventionFlags(SESSION, "09123", "view")).ok).toBe(true);

    const edit = await authorizeInterventionFlags(SESSION, "09123", "edit");
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.response.status).toBe(403);
  });

  it("refuses a PMU role at a non-JNV School, even at level 3", async () => {
    mockGetResolvedPermission.mockResolvedValue(PMU_MANAGER);
    mockQuery.mockResolvedValueOnce([NON_JNV_SCHOOL]);
    const result = await authorizeInterventionFlags(PMU_SESSION, "08888", "view");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(mockQuery.mock.calls[0][0]).toContain("af_school_category");
  });

  it("lets a PMU role into a JNV School in scope", async () => {
    mockGetResolvedPermission.mockResolvedValue(PMU_MANAGER);
    mockQuery.mockResolvedValueOnce([SCHOOL]);
    expect((await authorizeInterventionFlags(PMU_SESSION, "09123", "edit")).ok).toBe(true);
  });

  it("keeps non-JNV Schools open to other roles", async () => {
    mockGetResolvedPermission.mockResolvedValue({ ...TEACHER, school_codes: ["80808"] });
    mockQuery.mockResolvedValueOnce([NON_JNV_SCHOOL]);
    expect((await authorizeInterventionFlags(SESSION, "08888", "edit")).ok).toBe(true);
  });

  it("allows anyone who can edit the school's students to change flags", async () => {
    mockGetResolvedPermission.mockResolvedValue(TEACHER);
    mockQuery.mockResolvedValueOnce([SCHOOL]);
    const result = await authorizeInterventionFlags(SESSION, "09123", "edit");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.school).toEqual(SCHOOL);
      expect(result.actor).toMatchObject({ email: TEACHER.email, userId: 42 });
    }
  });
});

describe("interventionFlagAccess", () => {
  it("follows students access", () => {
    expect(interventionFlagAccess(TEACHER)).toEqual({ canView: true, canEdit: true });
    expect(interventionFlagAccess({ ...TEACHER, read_only: true })).toEqual({ canView: true, canEdit: false });
    expect(interventionFlagAccess(null)).toEqual({ canView: false, canEdit: false });
    expect(interventionFlagAccess({ ...TEACHER, role: "holistic_mentorship_admin" }).canView).toBe(false);
  });
});

describe("validateNote", () => {
  it("trims, requires when asked, and caps length", () => {
    expect(validateNote("  lost a parent  ", { required: true })).toEqual({ ok: true, note: "lost a parent" });
    expect(validateNote("   ", { required: true })).toEqual({ ok: false, error: "A note is required" });
    expect(validateNote(undefined, { required: false })).toEqual({ ok: true, note: "" });
    expect(validateNote(5, { required: false }).ok).toBe(false);
    expect(validateNote("x".repeat(2001), { required: true }).ok).toBe(false);
  });
});

describe("listSchoolFlags", () => {
  it("groups update history under each flag", async () => {
    mockQuery
      .mockResolvedValueOnce([
        { id: 2, student_pk_id: "5", status: "open", raised_by_email: "a@x", inserted_at: "t2", resolved_at: null },
        { id: 1, student_pk_id: "5", status: "resolved", raised_by_email: "a@x", inserted_at: "t1", resolved_at: "t1b" },
      ])
      .mockResolvedValueOnce([
        { flag_id: 1, id: 10, body: "first" },
        { flag_id: 2, id: 11, body: "second" },
        { flag_id: 1, id: 12, body: null },
      ]);

    const flags = await listSchoolFlags("7");

    expect(mockQuery).toHaveBeenLastCalledWith(expect.any(String), [[2, 1]]);
    expect(flags.map((f) => f.updates.map((u) => u.id))).toEqual([[11], [10, 12]]);
  });

  it("lists every flag when no Student scope is given", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await listSchoolFlags("7");
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("$2::bigint[] IS NULL"), ["7", null]);
  });

  it("narrows to the given Students and skips the query for an empty scope", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await listSchoolFlags("7", ["5", "6"]);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ["7", ["5", "6"]]);

    mockQuery.mockClear();
    expect(await listSchoolFlags("7", [])).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("skips the update query when the school has no flags", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await listSchoolFlags("7")).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("flagStudentScopeForPmu", () => {
  it("does not narrow other roles", async () => {
    expect(await flagStudentScopeForPmu(ACTOR, "7")).toBeNull();
    expect(getSchoolRoster).not.toHaveBeenCalled();
  });

  it("keeps only the mixed School's NVS roster for a PMU role", async () => {
    vi.mocked(getSchoolRoster).mockResolvedValue({
      issues: [],
      students: [
        rosterStudent("1", { student_program_ids: [64], program_id: 64 }), // current NVS
        rosterStudent("2", { student_program_ids: [1, 64], program_id: 1 }), // CoE + NVS
        rosterStudent("3", { dropout_program_ids: [64], status: "dropout", program_id: 64 }), // NVS dropout
        rosterStudent("4", { student_program_ids: [1], program_id: 1 }), // CoE only
        rosterStudent("5", { student_program_ids: [2], dropout_program_ids: [1] }), // Nodal, CoE dropout
        rosterStudent("6", {}), // unassigned
        rosterStudent(null, { student_program_ids: [64] }), // no student row
      ],
    });

    expect(await flagStudentScopeForPmu(PMU_ACTOR, "7")).toEqual(["1", "2", "3"]);
    expect(getSchoolRoster).toHaveBeenCalledWith("7");
  });
});

describe("mayRaiseFlagForPmu", () => {
  it("never checks other roles", async () => {
    expect(await mayRaiseFlagForPmu(ACTOR, 5)).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("requires a current NVS batch for a PMU role", async () => {
    mockQuery.mockResolvedValueOnce([{ has_current_nvs_batch: false }]);
    expect(await mayRaiseFlagForPmu(PMU_ACTOR, 5)).toBe(false);
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("b_nvs.program_id = 64"), [5]);

    mockQuery.mockResolvedValueOnce([{ has_current_nvs_batch: true }]);
    expect(await mayRaiseFlagForPmu(PMU_ACTOR, 5)).toBe(true);
  });
});

describe("mayUpdateFlagForPmu", () => {
  it("never checks other roles", async () => {
    expect(await mayUpdateFlagForPmu(ACTOR, 9, "7")).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("requires the flag's Student to have a current NVS batch for a PMU role", async () => {
    mockQuery.mockResolvedValueOnce([{ has_current_nvs_batch: false }]);
    expect(await mayUpdateFlagForPmu(PMU_ACTOR, 9, "7")).toBe(false);
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("b_nvs.program_id = 64"), [9, "7"]);

    mockQuery.mockResolvedValueOnce([]);
    expect(await mayUpdateFlagForPmu(PMU_ACTOR, 9, "7")).toBe(false);

    mockQuery.mockResolvedValueOnce([{ has_current_nvs_batch: true }]);
    expect(await mayUpdateFlagForPmu(PMU_ACTOR, 9, "7")).toBe(true);
  });
});

describe("raiseFlag", () => {
  it("inserts the flag and its first update with a normalized email", async () => {
    const { client, calls } = fakeClient([{ rows: [{ id: 9 }] }, { rows: [] }]);

    const result = await raiseFlag(client, {
      studentPkId: 5, schoolId: "7", programId: 1, actor: ACTOR, note: "Needs grief counselling",
    });

    expect(result).toEqual({ id: 9 });
    expect(calls[0].params).toEqual([5, "7", 1, "teacher@avantifellows.org", 42]);
    expect(calls[1].params).toEqual([9, "teacher@avantifellows.org", 42, "Needs grief counselling"]);
  });

  it("maps the one-open-flag unique violation to a 409", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "23505" });
    const { client } = fakeClient([duplicate]);

    await expect(
      raiseFlag(client, { studentPkId: 5, schoolId: "7", programId: null, actor: ACTOR, note: "x" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("addFlagUpdate", () => {
  it("404s a flag from another school", async () => {
    const { client } = fakeClient([{ rows: [] }]);
    await expect(
      addFlagUpdate(client, { flagId: 9, schoolId: "7", actor: ACTOR, note: "x", resolve: false }),
    ).rejects.toBeInstanceOf(InterventionFlagError);
  });

  it("409s resolving an already-resolved flag", async () => {
    const { client } = fakeClient([{ rows: [{ status: "resolved" }] }]);
    await expect(
      addFlagUpdate(client, { flagId: 9, schoolId: "7", actor: ACTOR, note: "", resolve: true }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("resolves an open flag and records the status change", async () => {
    const { client, calls } = fakeClient([{ rows: [{ status: "open" }] }]);

    const result = await addFlagUpdate(client, {
      flagId: 9, schoolId: "7", actor: ACTOR, note: "", resolve: true,
    });

    expect(result).toEqual({ status: "resolved" });
    expect(calls[1].sql).toContain("status = 'resolved'");
    expect(calls[2].params).toEqual([9, "teacher@avantifellows.org", 42, null, "open", "resolved"]);
  });

  it("adds a follow-up note without changing status", async () => {
    const { client, calls } = fakeClient([{ rows: [{ status: "open" }] }]);

    const result = await addFlagUpdate(client, {
      flagId: 9, schoolId: "7", actor: ACTOR, note: "Counsellor visited", resolve: false,
    });

    expect(result).toEqual({ status: "open" });
    expect(calls[1].sql).not.toContain("status = 'resolved'");
    expect(calls[2].params).toEqual([9, "teacher@avantifellows.org", 42, "Counsellor visited", null, null]);
  });
});
