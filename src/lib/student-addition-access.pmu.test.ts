import { beforeEach, describe, expect, it, vi } from "vitest";

// PMU roles through the real permission layer: only Postgres is mocked, so the
// matrix, program pinning (ADR 0007), read_only downgrade and School scope all
// run as in production.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { PROGRAM_IDS } from "./constants";
import {
  requireStudentAdditionAccess,
  requireStudentAdditionStudentAccess,
  requireStudentDropoutUndoAccess,
  requireStudentEditAccess,
  requireStudentProgramDropoutAccess,
} from "./student-addition-access";

const PMU_ROLES = ["pmu_manager", "pmu_govt_school_user"] as const;
type PmuRole = (typeof PMU_ROLES)[number];

const email = "pmu@avantifellows.org";
const session = { user: { email }, expires: "2099-01-01" };

// PMU Manager: region-scoped (level 2). PMU Govt School User: one JNV School.
function pmuRow(role: PmuRole, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: role === "pmu_manager" ? 2 : 1,
    role,
    school_codes: role === "pmu_manager" ? null : ["JNV001"],
    regions: role === "pmu_manager" ? ["South"] : null,
    program_ids: [PROGRAM_IDS.NVS],
    read_only: false,
    user_id: 777,
    ...overrides,
  };
}

const inScopeJnv = {
  code: "JNV001",
  udise_code: "12345678901",
  region: "South",
  af_school_category: "JNV",
};
const outOfScopeJnv = {
  code: "JNV999",
  udise_code: "99999999999",
  region: "North",
  af_school_category: "JNV",
};
const nonJnvInScope = { ...inScopeJnv, af_school_category: "Other" };

let permissionRow: Record<string, unknown>;
let studentScope: Record<string, unknown> | null;

beforeEach(() => {
  mockQuery.mockReset();
  studentScope = { ...inScopeJnv, has_program_enrollment: true, centre_program_ids: [] };
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM user_permission")) return [permissionRow];
    return studentScope ? [studentScope] : [];
  });
});

const forbidden = { ok: false, status: 403, error: "Forbidden" };

describe.each(PMU_ROLES)("%s student addition (Add Student, Bulk Upload, Download List)", (role) => {
  beforeEach(() => {
    permissionRow = pmuRow(role);
  });

  it("accepts an in-scope JNV School with the PMU role on the actor", async () => {
    expect(await requireStudentAdditionAccess(session, inScopeJnv)).toEqual({
      ok: true,
      permission: expect.objectContaining({ role }),
      programId: 64,
      actor: { user_id: 777, email, login_type: "google", role },
    });
  });

  it("refuses when read_only is set", async () => {
    permissionRow = pmuRow(role, { read_only: true });
    expect(await requireStudentAdditionAccess(session, inScopeJnv)).toEqual(forbidden);
  });

  it("refuses a non-JNV School", async () => {
    expect(await requireStudentAdditionAccess(session, nonJnvInScope)).toEqual(forbidden);
  });

  it("refuses a JNV School outside the PMU scope", async () => {
    expect(await requireStudentAdditionAccess(session, outOfScopeJnv)).toEqual(forbidden);
  });
});

describe.each(PMU_ROLES)("%s NVS Student writes (NVS dropout, phone correction)", (role) => {
  beforeEach(() => {
    permissionRow = pmuRow(role);
  });

  it("accepts a current NVS Student at an in-scope JNV School", async () => {
    expect(await requireStudentAdditionStudentAccess(session, 42)).toEqual({
      ok: true,
      permission: expect.objectContaining({ role }),
      programId: 64,
      school: { code: "JNV001", udise_code: "12345678901" },
      actor: { user_id: 777, email, login_type: "google", role },
    });
  });

  it("refuses when read_only is set", async () => {
    permissionRow = pmuRow(role, { read_only: true });
    expect(await requireStudentAdditionStudentAccess(session, 42)).toEqual(forbidden);
  });

  it("refuses a Student at a non-JNV School", async () => {
    studentScope = { ...nonJnvInScope, has_program_enrollment: true };
    expect(await requireStudentAdditionStudentAccess(session, 42)).toEqual(forbidden);
  });

  it("refuses a Student outside the PMU scope", async () => {
    studentScope = { ...outOfScopeJnv, has_program_enrollment: true };
    expect(await requireStudentAdditionStudentAccess(session, 42)).toEqual(forbidden);
  });

  it("refuses a Student with no current NVS Batch (non-NVS or unassigned)", async () => {
    studentScope = { ...inScopeJnv, has_program_enrollment: false };
    expect(await requireStudentAdditionStudentAccess(session, 42)).toEqual(forbidden);
  });
});

describe.each(PMU_ROLES)("%s NVS undo dropout", (role) => {
  beforeEach(() => {
    permissionRow = pmuRow(role);
  });

  it("accepts an undoable NVS dropout at an in-scope JNV School", async () => {
    expect(await requireStudentDropoutUndoAccess(session, 42)).toEqual({
      ok: true,
      permission: expect.objectContaining({ role }),
      programId: 64,
      school: { code: "JNV001", udise_code: "12345678901" },
      actor: { user_id: 777, email, login_type: "google", role },
    });
  });

  it("refuses when read_only is set", async () => {
    permissionRow = pmuRow(role, { read_only: true });
    expect(await requireStudentDropoutUndoAccess(session, 42)).toEqual(forbidden);
  });

  it("refuses at a non-JNV School", async () => {
    studentScope = { ...nonJnvInScope, has_program_enrollment: true };
    expect(await requireStudentDropoutUndoAccess(session, 42)).toEqual(forbidden);
  });

  it("refuses outside the PMU scope", async () => {
    studentScope = { ...outOfScopeJnv, has_program_enrollment: true };
    expect(await requireStudentDropoutUndoAccess(session, 42)).toEqual(forbidden);
  });

  it("refuses when there is no undoable NVS dropout", async () => {
    studentScope = null;
    expect(await requireStudentDropoutUndoAccess(session, 42)).toEqual(forbidden);
  });
});

describe.each(PMU_ROLES)("%s general Student profile edits", (role) => {
  beforeEach(() => {
    permissionRow = pmuRow(role, { program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS] });
  });

  it("accepts an NVS Student at an in-scope School", async () => {
    const result = await requireStudentEditAccess(session, 42, PROGRAM_IDS.NVS);
    expect(result).toMatchObject({ ok: true, programId: 64, actor: { role } });
  });

  it("refuses a non-NVS Student even when program_ids lists that program", async () => {
    expect(await requireStudentEditAccess(session, 42, PROGRAM_IDS.COE)).toEqual(forbidden);
  });

  it("refuses an unassigned Student (no program)", async () => {
    expect(await requireStudentEditAccess(session, 42, null)).toEqual({
      ok: false,
      status: 400,
      error: "Program is required",
    });
  });
});

describe.each(PMU_ROLES)("%s centre-program dropout", (role) => {
  beforeEach(() => {
    permissionRow = pmuRow(role, { program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS] });
  });

  it("is unreachable: the pinned context has no centre program", async () => {
    studentScope = {
      ...inScopeJnv,
      has_program_enrollment: true,
      centre_program_ids: [PROGRAM_IDS.COE],
    };
    expect(
      await requireStudentProgramDropoutAccess(session, 42, PROGRAM_IDS.COE),
    ).toEqual(forbidden);
  });
});
