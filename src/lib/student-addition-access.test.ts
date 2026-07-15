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
  requireStudentProgramDropoutAccess,
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
  centre_program_ids: [PROGRAM_IDS.NVS],
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
  mockGetFeatureAccess.mockReturnValue({
    access: "edit",
    canView: true,
    canEdit: true,
  });
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
      centre_program_ids: [PROGRAM_IDS.NVS],
      has_program_enrollment: true,
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

  it("allows an NVS-scoped writer when the school has no Centre mapping", async () => {
    mockGetResolvedPermission.mockResolvedValue(permission());
    const centreFreeSchool = {
      ...school,
      centre_program_ids: [],
    };

    const result = await requireStudentAdditionAccess(
      session,
      centreFreeSchool,
    );

    expect(result.ok).toBe(true);
  });

  it.each(["program_manager", "program_admin"] as const)(
    "allows an NVS-scoped %s",
    async (role) => {
      mockGetResolvedPermission.mockResolvedValue(permission({ role }));

      expect((await requireStudentAdditionAccess(session, school)).ok).toBe(true);
    },
  );

  it("blocks missing or revoked permissions", async () => {
    mockGetResolvedPermission.mockResolvedValue(null);

    expect(await requireStudentAdditionAccess(session, school)).toEqual({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
  });

  it("blocks admins without NVS program scope", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({
        role: "admin",
        program_ids: [PROGRAM_IDS.COE],
      }),
    );
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [PROGRAM_IDS.COE],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    });

    const result = await requireStudentAdditionAccess(session, school);

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it.each([
    ["teacher role", permission({ role: "teacher" })],
    ["read-only access", permission({ read_only: true })],
  ])("blocks %s", async (_label, userPermission) => {
    mockGetResolvedPermission.mockResolvedValue(userPermission);
    if (userPermission.read_only) {
      mockGetFeatureAccess.mockReturnValue({
        access: "view",
        canView: true,
        canEdit: false,
      });
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
      () => {
        mockGetResolvedPermission.mockResolvedValue(
          permission({ role: "program_manager" }),
        );
        mockGetProgramContextSync.mockReturnValue({
          hasAccess: true,
          programIds: [PROGRAM_IDS.COE],
          isNVSOnly: false,
          hasCoEOrNodal: true,
        });
      },
    ],
  ])("blocks %s", async (label, arrange) => {
    mockGetResolvedPermission.mockResolvedValue(permission());
    arrange();

    const result = await requireStudentAdditionAccess(
      session,
      school,
    );

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });
});

describe("requireStudentAdditionStudentAccess", () => {
  it("allows an allowed Google actor for an accessible NVS student", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager" }),
    );

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
    [
      "school scope denied",
      () => mockCanAccessSchoolSync.mockReturnValue(false),
    ],
    [
      "teacher role",
      () =>
        mockGetResolvedPermission.mockResolvedValue(
          permission({ role: "teacher" }),
        ),
    ],
    [
      "non-NVS student",
      () =>
        mockQuery.mockResolvedValue([
          {
            code: "JNV001",
            udise_code: "12345678901",
            region: "South",
            centre_program_ids: [PROGRAM_IDS.COE],
            has_program_enrollment: true,
          },
        ]),
    ],
  ])("blocks %s", async (_label, arrange) => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager" }),
    );
    arrange();

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("allows a student when the school has an active NVS centre", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager" }),
    );
    mockQuery.mockResolvedValue([
      {
        code: "JNV001",
        udise_code: "12345678901",
        region: "South",
        centre_program_ids: [PROGRAM_IDS.NVS],
        has_program_enrollment: true,
      },
    ]);

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result.ok).toBe(true);
  });

  it("allows admins to edit/dropout NVS students without explicit NVS program ids", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({
        role: "admin",
        program_ids: [PROGRAM_IDS.COE],
      }),
    );
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [PROGRAM_IDS.COE],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    });

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result.ok).toBe(true);
  });

  it("blocks a student without an active NVS centre even when legacy program fields include NVS", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager" }),
    );
    mockQuery.mockResolvedValue([
      {
        code: "JNV001",
        udise_code: "12345678901",
        region: "South",
        centre_program_ids: [],
        has_program_enrollment: true,
        program_ids: [PROGRAM_IDS.NVS],
        student_program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS],
      },
    ]);

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("blocks a current-batch NVS student when the centre mapping is missing", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager" }),
    );
    mockQuery.mockResolvedValue([
      {
        code: "JNV001",
        udise_code: "12345678901",
        region: "South",
        centre_program_ids: [],
        has_program_enrollment: true,
        student_program_ids: [PROGRAM_IDS.NVS],
      },
    ]);

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("blocks a non-NVS student at a school with an active NVS centre", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager" }),
    );
    mockQuery.mockResolvedValue([
      {
        code: "JNV001",
        udise_code: "12345678901",
        region: "South",
        centre_program_ids: [PROGRAM_IDS.NVS],
        has_program_enrollment: false,
      },
    ]);

    const result = await requireStudentAdditionStudentAccess(session, "100");

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });
});

describe("requireStudentProgramDropoutAccess", () => {
  it("allows a program manager to drop from a current program they own", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager", program_ids: [PROGRAM_IDS.COE] }),
    );
    mockGetProgramContextSync.mockReturnValue({
      hasAccess: true,
      programIds: [PROGRAM_IDS.COE],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    });
    mockQuery.mockResolvedValue([
      {
        code: "JNV001",
        udise_code: "12345678901",
        region: "South",
        centre_program_ids: [PROGRAM_IDS.COE],
        has_program_enrollment: true,
      },
    ]);

    const result = await requireStudentProgramDropoutAccess(
      session,
      "100",
      PROGRAM_IDS.COE,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.programId).toBe(PROGRAM_IDS.COE);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
      "100",
      PROGRAM_IDS.COE,
    ]);
  });

  it("blocks dropout from a program the actor does not own", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager", program_ids: [PROGRAM_IDS.NVS] }),
    );

    const result = await requireStudentProgramDropoutAccess(
      session,
      "100",
      PROGRAM_IDS.COE,
    );

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });
});
