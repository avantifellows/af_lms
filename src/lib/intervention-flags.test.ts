import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./permissions")>();
  return { ...actual, getResolvedPermission: vi.fn() };
});

import { query } from "./db";
import { getResolvedPermission, type UserPermission } from "./permissions";
import {
  InterventionFlagError,
  addFlagUpdate,
  authorizeInterventionFlags,
  canUseInterventionFlags,
  listSchoolFlags,
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
const SCHOOL = { id: "7", code: "70705", udise_code: "09123", name: "JNV Test", region: "North" };
const SESSION = { user: { email: TEACHER.email } };
const ACTOR: InterventionFlagActor = { email: "Teacher@AvantiFellows.org", userId: 42, permission: TEACHER };

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
    const result = await authorizeInterventionFlags(null, "70705");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects passcode logins before any lookup", async () => {
    const result = await authorizeInterventionFlags(
      { user: { email: "passcode_70705@avantifellows.org" }, isPasscodeUser: true },
      "70705",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(mockGetResolvedPermission).not.toHaveBeenCalled();
  });

  it("rejects users without a permission row", async () => {
    mockGetResolvedPermission.mockResolvedValue(null);
    const result = await authorizeInterventionFlags(SESSION, "70705");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns 404 for an unknown school", async () => {
    mockGetResolvedPermission.mockResolvedValue(TEACHER);
    mockQuery.mockResolvedValueOnce([]);
    const result = await authorizeInterventionFlags(SESSION, "99999");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("rejects a school outside the user's scope", async () => {
    mockGetResolvedPermission.mockResolvedValue(TEACHER);
    mockQuery.mockResolvedValueOnce([{ ...SCHOOL, code: "11111" }]);
    const result = await authorizeInterventionFlags(SESSION, "11111");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows anyone who can see the school's students, including read-only users", async () => {
    mockGetResolvedPermission.mockResolvedValue({ ...TEACHER, read_only: true });
    mockQuery.mockResolvedValueOnce([SCHOOL]);
    const result = await authorizeInterventionFlags(SESSION, "09123");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.school).toEqual(SCHOOL);
      expect(result.actor).toMatchObject({ email: TEACHER.email, userId: 42 });
    }
  });
});

describe("canUseInterventionFlags", () => {
  it("follows students view access and excludes passcode logins", () => {
    expect(canUseInterventionFlags(TEACHER)).toBe(true);
    expect(canUseInterventionFlags(null)).toBe(false);
    expect(canUseInterventionFlags(TEACHER, { isPasscodeUser: true })).toBe(false);
    expect(canUseInterventionFlags({ ...TEACHER, role: "holistic_mentorship_admin" })).toBe(false);
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

  it("skips the update query when the school has no flags", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await listSchoolFlags("7")).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
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
