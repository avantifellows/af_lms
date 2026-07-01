import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockGetResolvedPermission,
  mockCanAccessSchool,
  mockCanAccessSchoolSync,
  mockGetFeatureAccess,
  mockGetProgramContextSync,
  mockQuery,
} = vi.hoisted(() => ({
  mockGetResolvedPermission: vi.fn(),
  mockCanAccessSchool: vi.fn(),
  mockCanAccessSchoolSync: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockGetProgramContextSync: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("./permissions", () => ({
  canAccessSchool: mockCanAccessSchool,
  getResolvedPermission: mockGetResolvedPermission,
  canAccessSchoolSync: mockCanAccessSchoolSync,
  getFeatureAccess: mockGetFeatureAccess,
  getProgramContextSync: mockGetProgramContextSync,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { PROGRAM_IDS } from "./constants";
import {
  requireStudentAdditionAccess,
  requireStudentAdditionStudentAccess,
} from "./student-addition-access";
import type { UserPermission } from "./permissions";

const session = {
  user: { email: "admin@avantifellows.org" },
  expires: "2099-01-01",
};

const school = {
  code: "JNV001",
  udise_code: "12345678901",
  region: "South",
  program_ids: [PROGRAM_IDS.NVS],
};

function permission(overrides: Partial<UserPermission> = {}): UserPermission {
  return {
    email: "admin@avantifellows.org",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [PROGRAM_IDS.NVS],
    read_only: false,
    user_id: 501,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCanAccessSchool.mockResolvedValue(true);
  mockCanAccessSchoolSync.mockReturnValue(true);
  mockGetFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
  mockGetProgramContextSync.mockReturnValue({
    hasAccess: true,
    programIds: [PROGRAM_IDS.NVS],
    isNVSOnly: true,
    hasCoEOrNodal: false,
  });
  mockQuery.mockResolvedValue([
    {
      code: "JNV001",
      udise_code: "12345678901",
      region: "South",
      program_ids: [PROGRAM_IDS.NVS],
      student_program_ids: [PROGRAM_IDS.NVS],
    },
  ]);
});

describe("requireStudentAdditionAccess", () => {
  it("allows an admin with NVS program access to add students for an NVS school", async () => {
    mockGetResolvedPermission.mockResolvedValue(permission());

    const result = await requireStudentAdditionAccess(session, school);

    expect(result).toEqual({
      ok: true,
      permission: expect.objectContaining({ role: "admin" }),
      programId: PROGRAM_IDS.NVS,
      actor: {
        user_id: 501,
        email: "admin@avantifellows.org",
        login_type: "google",
        role: "admin",
      },
    });
  });

  it.each([
    ["teacher role", permission({ role: "teacher" })],
    ["read-only access", permission({ read_only: true })],
  ])("blocks %s", async (_label, userPermission) => {
    mockGetResolvedPermission.mockResolvedValue(userPermission);
    if (userPermission.read_only) {
      mockGetFeatureAccess.mockReturnValue({ access: "view", canView: true, canEdit: false });
    }

    const result = await requireStudentAdditionAccess(session, school);

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("blocks passcode school-login users even though they can view students", async () => {
    const result = await requireStudentAdditionAccess(
      { user: {}, isPasscodeUser: true },
      school,
    );

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
    expect(mockGetResolvedPermission).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong school", () => mockCanAccessSchoolSync.mockReturnValue(false)],
    [
      "wrong program",
      () => mockGetProgramContextSync.mockReturnValue({
        hasAccess: true,
        programIds: [PROGRAM_IDS.COE],
        isNVSOnly: false,
        hasCoEOrNodal: true,
      }),
    ],
    [
      "non-NVS school",
      () => undefined,
    ],
  ])("blocks %s", async (label, arrange) => {
    mockGetResolvedPermission.mockResolvedValue(permission());
    arrange();

    const result = await requireStudentAdditionAccess(
      session,
      label === "non-NVS school" ? { ...school, program_ids: [PROGRAM_IDS.COE] } : school,
    );

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });
});

describe("requireStudentAdditionStudentAccess", () => {
  it("allows an allowed Google actor for an accessible NVS student", async () => {
    mockGetResolvedPermission.mockResolvedValue(permission({ role: "program_manager" }));

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result).toEqual({
      ok: true,
      permission: expect.objectContaining({ role: "program_manager" }),
      programId: PROGRAM_IDS.NVS,
      school: { code: "JNV001", udise_code: "12345678901" },
      actor: {
        user_id: 501,
        email: "admin@avantifellows.org",
        login_type: "google",
        role: "program_manager",
      },
    });
  });

  it("blocks passcode users before resolving the student", async () => {
    const result = await requireStudentAdditionStudentAccess(
      { user: {}, isPasscodeUser: true },
      "100",
    );

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["school scope denied", () => mockCanAccessSchoolSync.mockReturnValue(false)],
    ["teacher role", () => mockGetResolvedPermission.mockResolvedValue(permission({ role: "teacher" }))],
    [
      "non-NVS student",
      () =>
        mockQuery.mockResolvedValue([
          {
            code: "JNV001",
            udise_code: "12345678901",
            region: "South",
            program_ids: [PROGRAM_IDS.NVS],
            student_program_ids: [PROGRAM_IDS.COE],
          },
        ]),
    ],
  ])("blocks %s", async (_label, arrange) => {
    mockGetResolvedPermission.mockResolvedValue(permission({ role: "program_manager" }));
    arrange();

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("allows an NVS-school student without a current batch program", async () => {
    mockGetResolvedPermission.mockResolvedValue(permission({ role: "program_manager" }));
    mockQuery.mockResolvedValue([
      {
        code: "JNV001",
        udise_code: "12345678901",
        region: "South",
        program_ids: [PROGRAM_IDS.NVS],
        student_program_ids: [],
      },
    ]);

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result.ok).toBe(true);
  });

  it("allows a student with an NVS current batch among other current batches", async () => {
    mockGetResolvedPermission.mockResolvedValue(permission({ role: "program_manager" }));
    mockQuery.mockResolvedValue([
      {
        code: "JNV001",
        udise_code: "12345678901",
        region: "South",
        program_ids: [PROGRAM_IDS.NVS],
        student_program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS],
      },
    ]);

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result.ok).toBe(true);
  });
});
