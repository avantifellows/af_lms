import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { requireHolisticMentorshipAccess } from "./holistic-mentorship";

const mockQuery = vi.mocked(query);

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
    ["program_manager", false],
    ["program_admin", false],
  ] as const)("applies Program-wide access for %s", async (role, allowed) => {
    mockQuery.mockResolvedValueOnce([permissionRow(role)]);

    const result = await requireHolisticMentorshipAccess(
      { user: { email: `${role}@example.com` } },
      "program_read"
    );

    expect(result.ok).toBe(allowed);
    if (!allowed) expect(result).toMatchObject({ status: 403 });
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
      "profile_regenerate"
    );

    expect(result.ok).toBe(allowed);
    if (!allowed) expect(result).toMatchObject({ status: 403 });
  });

  it("lets Program-wide Admins read mapped Student data but not mutate Mappings", async () => {
    mockQuery.mockResolvedValueOnce([permissionRow("holistic_mentorship_admin")]);
    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "holistic_mentorship_admin@example.com" } },
        "mapped_student_read"
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

  it("allows an active Teacher seat at a Program 1 School", async () => {
    mockTeacherScope();
    mockQuery
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "School One", region: "North" },
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
    expect(String(schoolLookup?.[0])).toContain("FROM centres centre");
    expect(String(schoolLookup?.[0])).toContain("centre.school_id = school.id");
    expect(String(schoolLookup?.[0])).toContain("centre.program_id = $2");
    expect(String(schoolLookup?.[0])).not.toContain("school.program_ids");
    expect(schoolLookup?.[1]).toEqual(["SCH001", 1]);
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
        { id: 20, code: "SCH001", name: "School One", region: "North" },
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
        { id: 20, code: "SCH001", name: "School One", region: "North" },
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
        { id: 20, code: "SCH001", name: "School One", region: "North" },
      ])
      .mockResolvedValueOnce([{ user_id: 10 }])
      .mockResolvedValueOnce([{ id: 73 }]);

    await expect(
      requireHolisticMentorshipAccess(
        { user: { email: "teacher@example.com" } },
        "mapped_student_read",
        { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027" }
      )
    ).resolves.toMatchObject({ ok: true, actorUserId: 10 });
  });

  it.each(["admin", "holistic_mentorship_admin"] as const)(
    "allows scoped %s read-only Student drill-down",
    async (role) => {
      mockQuery
        .mockResolvedValueOnce([permissionRow(role)])
        .mockResolvedValueOnce([
          { id: 20, code: "SCH001", name: "School One", region: "North" },
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
          { id: 20, code: "SCH001", name: "School One", region: "North" },
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
    "denies %s Student drill-down before protected Student data access",
    async (role) => {
      mockQuery.mockResolvedValueOnce([permissionRow(role)]);

      await expect(
        requireHolisticMentorshipAccess(
          { user: { email: `${role}@example.com` } },
          "mapped_student_read",
          { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027" }
        )
      ).resolves.toMatchObject({ ok: false, status: 403 });
      expect(mockQuery).toHaveBeenCalledTimes(1);
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

  it("allows only a writable global Admin to execute approved privacy deletion", async () => {
    mockQuery.mockResolvedValueOnce([permissionRow("admin")]);
    await expect(requireHolisticMentorshipAccess(
      { user: { email: "admin@example.com" } }, "privacy_delete"
    )).resolves.toMatchObject({ ok: true, canEdit: true });
  });
});
