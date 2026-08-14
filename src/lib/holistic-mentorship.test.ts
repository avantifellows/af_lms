import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./holistic-reconciliation", () => ({ reconcileHolisticMappings: vi.fn() }));

import { query } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import { requireHolisticMentorshipAccess } from "./holistic-mentorship";

const mockQuery = vi.mocked(query);
const mockReconcile = vi.mocked(reconcileHolisticMappings);

function permissionRow(
  role: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    email: `${role}@example.com`,
    level: 3,
    role,
    school_codes: null,
    regions: null,
    program_ids: role === "holistic_mentorship_admin" ? [1] : null,
    read_only: false,
    user_id: 10,
    ...overrides,
  };
}

function mockTeacherScope(overrides: Record<string, unknown> = {}) {
  mockQuery
    .mockResolvedValueOnce([
      permissionRow("teacher", {
        email: "teacher@example.com",
        level: 1,
        school_codes: [],
        program_ids: [],
        ...overrides,
      }),
    ])
    .mockResolvedValueOnce([{ centre_id: 5 }])
    .mockResolvedValueOnce([{ code: "SCH001" }])
    .mockResolvedValueOnce([{ program_id: 1 }]);
}

describe("requireHolisticMentorshipAccess", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockReconcile.mockReset();
    mockReconcile.mockResolvedValue(0);
  });

  it("rejects unauthenticated access before data access", async () => {
    await expect(
      requireHolisticMentorshipAccess(null, "program_read")
    ).resolves.toEqual({ ok: false, status: 401, error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects passcode access before data access", async () => {
    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "passcode@school.local" }, isPasscodeUser: true },
        "program_read"
      )
    ).resolves.toMatchObject({ ok: false, status: 403 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["admin", true],
    ["holistic_mentorship_admin", true],
    ["teacher", false],
  ] as const)("applies Program-wide access for %s", async (role, allowed) => {
    mockQuery.mockResolvedValueOnce([permissionRow(role)]);

    const result = await requireHolisticMentorshipAccess(
      { user: { email: `${role}@example.com` } },
      "program_read"
    );

    expect(result.ok).toBe(allowed);
    if (!allowed) expect(result).toMatchObject({ status: 403 });
  });

  it.each(["program_manager", "program_admin"] as const)(
    "permits a scoped %s to read only supported Programs with an accessible School",
    async (role) => {
    mockQuery
      .mockResolvedValueOnce([permissionRow(role, {
        level: 1,
        school_codes: ["SCH001"],
        program_ids: [1, 64],
        user_id: null,
      })])
      .mockResolvedValueOnce([{ program_id: "1" }]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: `${role}@example.com` } },
      "program_read",
    )).resolves.toMatchObject({
      ok: true,
      canEdit: false,
      programId: 1,
      programIds: [1],
    });

    const [sql, params] = mockQuery.mock.calls[1];
    expect(String(sql)).toContain("centre.program_id = ANY($1::bigint[])");
    expect(String(sql)).toContain("school.code = ANY($2::text[])");
    expect(params).toEqual([[1], ["SCH001"]]);
  });

  it("preserves scoped progress reads for a read-only Program Manager", async () => {
    mockQuery
      .mockResolvedValueOnce([permissionRow("program_manager", {
        level: 1, school_codes: ["SCH001"], program_ids: [1], user_id: null, read_only: true,
      })])
      .mockResolvedValueOnce([{ program_id: 1 }]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: "program_manager@example.com" } },
      "program_read",
      { programId: 1 },
    )).resolves.toMatchObject({ ok: true, canEdit: false, programIds: [1] });
  });

  it.each(["program_manager", "program_admin"] as const)(
    "permits a read-only %s to open Assignment Coverage for an in-scope supported-Program School",
    async (role) => {
      mockQuery
        .mockResolvedValueOnce([permissionRow(role, {
          level: 1,
          school_codes: ["SCH001"],
          program_ids: [1],
          user_id: null,
          read_only: true,
        })])
        .mockResolvedValueOnce([
          { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
        ]);

      await expect(requireHolisticMentorshipAccess(
        { user: { email: `${role}@example.com` } },
        "assignment_coverage_read",
        { schoolCode: "SCH001", programId: 1 },
      )).resolves.toMatchObject({
        ok: true,
        canEdit: false,
        programId: 1,
        school: { id: 20, code: "SCH001", programId: 1 },
      });
    },
  );

  it("denies workspace entry when no supported-Program School is in resolved scope", async () => {
    mockQuery
      .mockResolvedValueOnce([permissionRow("program_admin", {
        level: 1, school_codes: [], program_ids: [1], user_id: null,
      })])
      .mockResolvedValueOnce([]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: "program_admin@example.com" } },
      "program_read",
    )).resolves.toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("denies a supported Program outside the scoped actor's assigned Programs", async () => {
    mockQuery.mockResolvedValueOnce([permissionRow("program_manager", {
      level: 1, school_codes: ["SCH001"], program_ids: [1], user_id: null,
    })]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: "program_manager@example.com" } },
      "program_read",
      { programId: 78 },
    )).resolves.toEqual({ ok: false, status: 403, error: "Forbidden" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("denies a Program Manager's direct progress request for an out-of-scope School", async () => {
    mockQuery
      .mockResolvedValueOnce([permissionRow("program_manager", {
        level: 1, school_codes: ["SCH001"], program_ids: [1], user_id: null,
      })])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH999", name: "Other School", region: "South", program_id: 1 },
      ]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: "program_manager@example.com" } },
      "program_read",
      { programId: 1, schoolCode: "SCH999" },
    )).resolves.toEqual({ ok: false, status: 403, error: "Forbidden" });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("denies Assignment Coverage when the School's supported Program is outside the manager's assigned Programs", async () => {
    mockQuery
      .mockResolvedValueOnce([permissionRow("program_manager", {
        level: 1,
        school_codes: ["SCH001"],
        program_ids: [1],
        user_id: null,
      })])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 78 },
      ]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: "program_manager@example.com" } },
      "assignment_coverage_read",
      { programId: 78, schoolCode: "SCH001" },
    )).resolves.toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("requires an explicit Program for Assignment Coverage at a multi-Program School", async () => {
    const scopedManager = permissionRow("program_manager", {
      level: 1,
      school_codes: ["SCH001"],
      program_ids: [1, 78],
      user_id: null,
    });
    mockQuery
      .mockResolvedValueOnce([scopedManager])
      .mockResolvedValueOnce([]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: "program_manager@example.com" } },
      "assignment_coverage_read",
      { schoolCode: "SCH001" },
    )).resolves.toEqual({ ok: false, status: 404, error: "School not found" });

    mockQuery
      .mockResolvedValueOnce([scopedManager])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 78 },
      ]);

    await expect(requireHolisticMentorshipAccess(
      { user: { email: "program_manager@example.com" } },
      "assignment_coverage_read",
      { schoolCode: "SCH001", programId: 78 },
    )).resolves.toMatchObject({
      ok: true,
      programId: 78,
      programIds: [78],
      school: { id: 20, code: "SCH001", programId: 78 },
    });
  });

  it("denies a read-only Holistic Mentorship Admin write actions", async () => {
    mockQuery.mockResolvedValueOnce([
      permissionRow("holistic_mentorship_admin", { read_only: true }),
    ]);
    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "holistic_mentorship_admin@example.com" } },
        "phase_configure"
      )
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it.each([
    ["admin", true],
    ["holistic_mentorship_admin", true],
    ["teacher", false],
    ["program_manager", false],
    ["program_admin", false],
  ] as const)("applies Profile regeneration access for %s", async (role, allowed) => {
    mockQuery.mockResolvedValueOnce([permissionRow(role)]);

    const result = await requireHolisticMentorshipAccess(
      { user: { email: `${role}@example.com` } },
      "profile_regenerate",
      { programId: 1 }
    );

    expect(result.ok).toBe(allowed);
    if (!allowed) expect(result).toMatchObject({ status: 403 });
  });

  it("lets Program-wide Admins read mapped Student data but not mutate Mappings", async () => {
    mockQuery.mockResolvedValueOnce([permissionRow("holistic_mentorship_admin")]);
    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "holistic_mentorship_admin@example.com" } },
        "mapped_student_read",
        { programId: 1 }
      )
    ).resolves.toMatchObject({ ok: true });

    mockQuery.mockResolvedValueOnce([permissionRow("holistic_mentorship_admin")]);
    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "holistic_mentorship_admin@example.com" } },
        "mapping_mutation"
      )
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it.each([
    ["admin", false, true],
    ["holistic_mentorship_admin", false, true],
    ["teacher", false, false],
    ["program_manager", false, false],
    ["program_admin", false, false],
    ["admin", true, false],
    ["holistic_mentorship_admin", true, false],
  ] as const)(
    "applies Admin Mapping mutation access for %s (read_only=%s)",
    async (role, readOnly, allowed) => {
      mockQuery.mockResolvedValueOnce([permissionRow(role, { read_only: readOnly })]);

      const result = await requireHolisticMentorshipAccess(
        { user: { email: `${role}@example.com` } },
        "admin_mapping_mutation",
        { programId: 1 },
      );

      expect(result.ok).toBe(allowed);
      if (!allowed) expect(result).toMatchObject({ status: 403 });
    },
  );

  it("denies passcode users the Admin Mapping mutation action before data access", async () => {
    await expect(requireHolisticMentorshipAccess(
      { user: { email: "passcode@school.local" }, isPasscodeUser: true },
      "admin_mapping_mutation",
      { programId: 1 },
    )).resolves.toMatchObject({ ok: false, status: 403 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows an active Teacher seat at a Program 1 School", async () => {
    mockTeacherScope();
    mockQuery
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
      ])
      .mockResolvedValueOnce([{ user_id: 10 }]);

    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "teacher@example.com" } },
        "roster_view",
        { schoolCode: "SCH001" }
      )
    ).resolves.toMatchObject({
      ok: true,
      actorUserId: 10,
      school: { id: 20, code: "SCH001" },
    });

    const schoolLookup = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM school")
    );
    expect(String(schoolLookup?.[0])).toContain("JOIN centres centre");
    expect(String(schoolLookup?.[0])).toContain("centre.school_id = school.id");
    expect(String(schoolLookup?.[0])).toContain("centre.program_id = ANY($2::bigint[])");
    expect(String(schoolLookup?.[0])).not.toContain("school.program_ids");
    expect(schoolLookup?.[1]).toEqual(["SCH001", [1, 78], null]);
  });

  it("returns a safe 404 before checking Teacher eligibility", async () => {
    mockTeacherScope();
    mockQuery.mockResolvedValueOnce([]);

    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "teacher@example.com" } },
        "roster_view",
        { schoolCode: "MISSING" }
      )
    ).resolves.toEqual({ ok: false, status: 404, error: "School not found" });
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("denies a Teacher without an active eligible seat at the School", async () => {
    mockTeacherScope();
    mockQuery
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
      ])
      .mockResolvedValueOnce([]);

    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "teacher@example.com" } },
        "roster_view",
        { schoolCode: "SCH001" }
      )
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("denies a School that is not dynamically mapped to Program 1", async () => {
    mockTeacherScope();
    mockQuery.mockResolvedValueOnce([]);

    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "teacher@example.com" } },
        "roster_view",
        { schoolCode: "SCH002" }
      )
    ).resolves.toMatchObject({ ok: false, status: 404 });
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("denies Student data before access when the Teacher has no current Mapping", async () => {
    mockTeacherScope();
    mockQuery
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
      ])
      .mockResolvedValueOnce([{ user_id: 10 }])
      .mockResolvedValueOnce([]);

    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "teacher@example.com" } },
        "mapped_student_read",
        { schoolCode: "SCH001", studentId: 99 }
      )
    ).resolves.toMatchObject({ ok: false, status: 404 });
    expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain(
      "holistic_mentorship_mentor_mentee_mappings"
    );
  });

  it("allows a current eligible Mentor to read their mapped Student", async () => {
    mockTeacherScope();
    mockQuery
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
      ])
      .mockResolvedValueOnce([{ user_id: 10 }])
      .mockResolvedValueOnce([{ id: 73 }]);

    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "teacher@example.com" } },
        "mapped_student_read",
        {
          schoolCode: "SCH001",
          studentId: 41,
          programId: 1,
          academicYear: "2026-2027",
        }
      )
    ).resolves.toMatchObject({ ok: true, actorUserId: 10 });
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      programId: 1,
      schoolId: 20,
      studentIds: [41],
    });
    expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain(
      "FROM student"
    );
    expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain(
      "JOIN centre_students roster_student"
    );
    expect(String(mockQuery.mock.calls.at(-1)?.[0])).toContain(
      "HAVING COUNT(DISTINCT roster_student.grade) = 1"
    );
  });

  it.each(["admin", "holistic_mentorship_admin"] as const)(
    "allows scoped %s read-only Student drill-down",
    async (role) => {
      mockQuery
        .mockResolvedValueOnce([permissionRow(role)])
        .mockResolvedValueOnce([
          { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
        ]);

      await expect(
        requireHolisticMentorshipAccess(
          { user: { email: `${role}@example.com` } },
          "mapped_student_read",
          { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027" }
        )
      ).resolves.toMatchObject({ ok: true, canEdit: true });
    }
  );

  it.each(["admin", "holistic_mentorship_admin"] as const)(
    "allows scoped %s prior-year Student drill-down without an active Mapping",
    async (role) => {
      mockQuery
        .mockResolvedValueOnce([permissionRow(role)])
        .mockResolvedValueOnce([
          { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
        ]);

      await expect(
        requireHolisticMentorshipAccess(
          { user: { email: `${role}@example.com` } },
          "mapped_student_read",
          { schoolCode: "SCH001", studentId: 41, academicYear: "2025-2026" }
        )
      ).resolves.toMatchObject({ ok: true });
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(String(mockQuery.mock.calls.at(-1)?.[0])).not.toContain(
        "holistic_mentorship_mentor_mentee_mappings"
      );
    }
  );

  it.each(["program_manager", "program_admin"] as const)(
    "allows %s read-only Student drill-down inside resolved School and Program scope",
    async (role) => {
      mockQuery
        .mockResolvedValueOnce([permissionRow(role, {
          level: 1,
          school_codes: ["SCH001"],
          program_ids: [1],
          user_id: null,
        })])
        .mockResolvedValueOnce([
          { id: 20, code: "SCH001", name: "School One", region: "North", program_id: 1 },
        ]);

      await expect(
        requireHolisticMentorshipAccess(
          { user: { email: `${role}@example.com` } },
          "mapped_student_read",
          {
            schoolCode: "SCH001",
            studentId: 41,
            programId: 1,
            academicYear: "2026-2027",
          }
        )
      ).resolves.toMatchObject({
        ok: true,
        canEdit: false,
        programId: 1,
        programIds: [1],
        school: { id: 20, code: "SCH001", programId: 1 },
      });
    }
  );

  it.each(["holistic_mentorship_admin", "teacher", "program_manager", "program_admin"] as const)(
    "denies %s approved privacy deletion",
    async (role) => {
      mockQuery.mockResolvedValueOnce([permissionRow(role)]);
      await expect(requireHolisticMentorshipAccess(
        { user: { email: `${role}@example.com` } }, "privacy_delete"
      )).resolves.toMatchObject({ ok: false, status: 403 });
    }
  );

  it("denies approved privacy deletion to a writable global Admin", async () => {
    mockQuery.mockResolvedValueOnce([permissionRow("admin")]);
    await expect(requireHolisticMentorshipAccess(
      { user: { email: "admin@example.com" } }, "privacy_delete"
    )).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("fails closed when a global Admin has no canonical User ID", async () => {
    mockQuery.mockResolvedValueOnce([permissionRow("admin", { user_id: null })]);
    await expect(requireHolisticMentorshipAccess(
      { user: { email: "admin@example.com" } }, "privacy_delete"
    )).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("denies approved privacy deletion to a read-only global Admin", async () => {
    mockQuery.mockResolvedValueOnce([permissionRow("admin", { read_only: true })]);
    await expect(requireHolisticMentorshipAccess(
      { user: { email: "admin@example.com" } }, "privacy_delete"
    )).resolves.toMatchObject({ ok: false, status: 403 });
  });
});
