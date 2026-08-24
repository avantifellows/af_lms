import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockAccess, mockRoster, mockAssign, mockAdminAssign, mockAdminReassign, mockAdminRemove, mockRemove } = vi.hoisted(
  () => ({
    mockSession: vi.fn(),
    mockAccess: vi.fn(),
    mockRoster: vi.fn(),
    mockAssign: vi.fn(),
    mockAdminAssign: vi.fn(),
    mockAdminReassign: vi.fn(),
    mockAdminRemove: vi.fn(),
    mockRemove: vi.fn(),
  })
);

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({
  requireHolisticMentorshipAccess: mockAccess,
}));
vi.mock("@/lib/holistic-mappings", () => ({
  listHolisticAssignmentRoster: mockRoster,
  assignHolisticMentees: mockAssign,
  assignHolisticMenteeAsAdmin: mockAdminAssign,
  reassignHolisticMenteeAsAdmin: mockAdminReassign,
  removeHolisticMenteeAsAdmin: mockAdminRemove,
  removeHolisticMentees: mockRemove,
}));

import { DELETE, GET, PATCH, POST } from "./route";

const permission = {
  email: "teacher@example.com",
  level: 1,
  role: "teacher",
  school_codes: ["SCH001"],
  program_ids: [1],
  user_id: 19,
};

type AdminMutationKind = "assign" | "reassign" | "remove";

function adminMutationBody(kind: AdminMutationKind, reason: string) {
  const common = {
    school_code: "SCH001",
    program_id: 1,
    academic_year: "2026-2027",
    student_id: 41,
    confirmed: true,
    reason,
  };
  if (kind === "assign") {
    return { ...common, mentor_user_id: 27, expected_mapping_id: null };
  }
  if (kind === "reassign") {
    return { ...common, mentor_user_id: 27, expected_mapping_id: 73 };
  }
  return { ...common, expected_mapping_id: 73 };
}

async function callAdminMutation(kind: AdminMutationKind, reason: string) {
  const body = JSON.stringify(adminMutationBody(kind, reason));
  if (kind === "assign") {
    return POST(new Request("http://localhost/api/holistic-mentorship/mappings", {
      method: "POST",
      body,
    }) as never);
  }
  if (kind === "reassign") {
    return PATCH(new Request("http://localhost/api/holistic-mentorship/mappings", {
      method: "PATCH",
      body,
    }) as never);
  }
  return DELETE(new Request("http://localhost/api/holistic-mentorship/mappings", {
    method: "DELETE",
    body,
  }) as never);
}

describe("Holistic Mentorship Mapping API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { email: "teacher@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      email: " Teacher@Example.com ",
      actorUserId: 9,
      school: { id: 4, code: "SCH001" },
      permission,
    });
  });

  it.each(["", "null", undefined])("rejects missing roster Program context (%s)", async (programId) => {
    const query = programId === undefined ? "" : `&program_id=${programId}`;
    const response = await GET(new Request(
      `http://localhost/api/holistic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027${query}`,
    ) as never);

    expect(response.status).toBe(400);
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("returns the eligible roster even when the Teacher has zero Mappings", async () => {
    mockRoster.mockResolvedValue([]);

    const response = await GET(
      new Request(
        "http://localhost/api/holistic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&program_id=1&grade=11&search=asha"
      ) as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ students: [], actorUserId: 9 });
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "teacher@example.com" } },
      "roster_view",
      { schoolCode: "SCH001", programId: 1 }
    );
    expect(mockRoster).toHaveBeenCalledWith({
      permission,
      actorUserId: 9,
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      grade: 11,
      search: "asha",
    });
  });

  it("uses the email-resolved canonical Mentor ID for a read-only permission-only Teacher roster", async () => {
    const permissionOnlyTeacher = { ...permission, user_id: null, read_only: true };
    mockAccess.mockResolvedValueOnce({
      ok: true,
      email: "mentor@example.com",
      actorUserId: 9,
      school: { id: 4, code: "SCH001" },
      permission: permissionOnlyTeacher,
      canEdit: false,
    });
    mockRoster.mockResolvedValue([]);

    const response = await GET(new Request(
      "http://localhost/api/holistic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&program_id=1",
    ) as never);

    expect(response.status).toBe(200);
    expect(mockRoster).toHaveBeenCalledWith({
      permission: permissionOnlyTeacher,
      actorUserId: 9,
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      grade: null,
      search: "",
    });
  });

  it("validates and applies an atomic unassigned-only claim with audit identity", async () => {
    mockAssign.mockResolvedValue({ ok: true, changed: 1 });
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          selections: [{ student_id: 41, expected_mapping_id: null }],
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "teacher@example.com" } },
      "mapping_mutation",
      { schoolCode: "SCH001", programId: 1 }
    );
    expect(mockAssign).toHaveBeenCalledWith({
      actorUserId: 9,
      auditActorUserId: 19,
      actorEmail: "teacher@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: null }],
    });
  });

  it.each([
    [{}, "Program is required"],
    [{ program_id: null }, "Invalid Program"],
    [{ program_id: "" }, "Invalid Program"],
    [{ program_id: "1" }, "Invalid Program"],
    [{ program_id: 1.5 }, "Invalid Program"],
    [{ program_id: 999 }, "Invalid Program"],
  ])("requires one explicit supported Program for Teacher claim", async (program, error) => {
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          selections: [{ student_id: 41, expected_mapping_id: null }],
          ...program,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it("accepts the scalar Admin assign contract with normalized audit identity", async () => {
    mockAdminAssign.mockResolvedValue({ ok: true, changed: 1 });

    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 78,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: null,
          confirmed: true,
          reason: "  Student requested a new mentor  ",
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, changed: 1 });
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "teacher@example.com" } },
      "admin_mapping_mutation",
      { schoolCode: "SCH001", programId: 78 },
    );
    expect(mockAdminAssign).toHaveBeenCalledWith({
      actorEmail: "teacher@example.com",
      auditActorUserId: 19,
      schoolId: 4,
      programId: 78,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: null,
      confirmed: true,
      reason: "Student requested a new mentor",
    });
    expect(mockAssign).not.toHaveBeenCalled();
  });

  it.each([
    [{ confirmed: false }, "Assignment confirmation is required"],
    [{ reason: "   " }, "Assignment reason is required"],
    [{ academic_year: "2025-2026" }, "Admin Mapping assignments are limited to the current Academic Year"],
    [{ expected_mapping_id: 73 }, "Expected Mapping must be unassigned"],
  ] as const)("returns a client-actionable Admin assign validation error", async (override, error) => {
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: null,
          confirmed: true,
          reason: "Student request",
          ...override,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockAdminAssign).not.toHaveBeenCalled();
  });

  it.each(["assign", "reassign", "remove"] as const)(
    "accepts an exactly 500-character Admin %s reason",
    async (kind) => {
      mockAdminAssign.mockResolvedValue({ ok: true, changed: 1 });
      mockAdminReassign.mockResolvedValue({ ok: true, changed: 1 });
      mockAdminRemove.mockResolvedValue({ ok: true, changed: 1 });
      const reason = "r".repeat(500);

      const response = await callAdminMutation(kind, reason);

      expect(response.status).toBe(200);
      const mutationMock = {
        assign: mockAdminAssign,
        reassign: mockAdminReassign,
        remove: mockAdminRemove,
      }[kind];
      expect(mutationMock).toHaveBeenCalledWith(expect.objectContaining({ reason }));
    },
  );

  it.each(["assign", "reassign", "remove"] as const)(
    "rejects a 501-character Admin %s reason before authorization or mutation",
    async (kind) => {
      const response = await callAdminMutation(kind, "r".repeat(501));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Audit reason must be 500 characters or fewer",
      });
      expect(mockSession).not.toHaveBeenCalled();
      expect(mockAccess).not.toHaveBeenCalled();
      expect(mockAdminAssign).not.toHaveBeenCalled();
      expect(mockAdminReassign).not.toHaveBeenCalled();
      expect(mockAdminRemove).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{}, "Program is required"],
    [{ program_id: null }, "Invalid Program"],
    [{ program_id: "" }, "Invalid Program"],
    [{ program_id: "1" }, "Invalid Program"],
    [{ program_id: 1.5 }, "Invalid Program"],
    [{ program_id: 999 }, "Invalid Program"],
  ])("requires one explicit unambiguous Program for Admin assign", async (program, error) => {
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: null,
          confirmed: true,
          reason: "Student request",
          ...program,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockAdminAssign).not.toHaveBeenCalled();
  });

  it("returns refreshed ownership when Admin assign loses an ownership race", async () => {
    const ownership = [{
      studentId: 41,
      ownership: { mappingId: 73, mentorUserId: 8, mentorName: "Nila Sen" },
    }];
    mockAdminAssign.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Student is already assigned",
      ownership,
    });

    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: null,
          confirmed: true,
          reason: "Student request",
        }),
      }) as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Student is already assigned",
      ownership,
    });
  });

  it("rejects an ambiguous School/Program resolution before assignment", async () => {
    mockAccess.mockResolvedValueOnce({ ok: false, status: 404, error: "School not found" });
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "MULTI001",
          program_id: 78,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: null,
          confirmed: true,
          reason: "Student request",
        }),
      }) as never,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "School not found" });
    expect(mockAdminAssign).not.toHaveBeenCalled();
  });

  it.each([
    ["apm", 31],
    ["pm", 32],
    ["spm", 33],
    ["ph", 34],
  ])("surfaces the ineligible %s seat-role error", async (_seatRole, mentorUserId) => {
    mockAdminAssign.mockResolvedValueOnce({
      ok: false,
      status: 422,
      error: "Mentor is not eligible for this School and Program",
    });
    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: mentorUserId,
          expected_mapping_id: null,
          confirmed: true,
          reason: "Student request",
        }),
      }) as never,
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Mentor is not eligible for this School and Program",
    });
  });

  it("returns current ownership when an old takeover request names an active Mapping", async () => {
    const ownership = [{
      studentId: 42,
      ownership: { mappingId: 74, mentorUserId: 8, mentorName: "Nila Sen" },
    }];
    mockAssign.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Student is already assigned to another Mentor",
      ownership,
    });

    const response = await POST(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          takeover_confirmed: true,
          selections: [{ student_id: 42, expected_mapping_id: 74 }],
        }),
      }) as never
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Student is already assigned to another Mentor",
      ownership,
    });
    expect(mockAssign).toHaveBeenCalledWith(expect.not.objectContaining({
      takeoverConfirmed: expect.anything(),
    }));
  });

  it("requires confirmation and current Mapping revisions for removal", async () => {
    mockRemove.mockResolvedValue({ ok: true, changed: 1 });
    const response = await DELETE(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          confirmed: true,
          mappings: [{ student_id: 41, expected_mapping_id: 73 }],
        }),
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRemove).toHaveBeenCalledWith({
      actorUserId: 9,
      auditActorUserId: 19,
      actorEmail: "teacher@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      confirmed: true,
      mappings: [{ studentId: 41, expectedMappingId: 73 }],
    });
  });

  it.each([
    [{}, "Program is required"],
    [{ program_id: null }, "Invalid Program"],
    [{ program_id: "" }, "Invalid Program"],
    [{ program_id: "1" }, "Invalid Program"],
    [{ program_id: 1.5 }, "Invalid Program"],
    [{ program_id: 999 }, "Invalid Program"],
  ])("requires one explicit supported Program for Teacher self-unassign", async (program, error) => {
    const response = await DELETE(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          confirmed: true,
          mappings: [{ student_id: 41, expected_mapping_id: 73 }],
          ...program,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("accepts the scalar Admin remove contract with normalized audit identity", async () => {
    mockAdminRemove.mockResolvedValue({ ok: true, changed: 1 });

    const response = await DELETE(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 78,
          academic_year: "2026-2027",
          student_id: 41,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "  Mentor left the programme  ",
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, changed: 1 });
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "teacher@example.com" } },
      "admin_mapping_mutation",
      { schoolCode: "SCH001", programId: 78 },
    );
    expect(mockAdminRemove).toHaveBeenCalledWith({
      actorEmail: "teacher@example.com",
      auditActorUserId: 19,
      schoolId: 4,
      programId: 78,
      academicYear: "2026-2027",
      studentId: 41,
      expectedMappingId: 73,
      confirmed: true,
      reason: "Mentor left the programme",
    });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("accepts the exact Admin reassign PATCH contract with normalized audit values", async () => {
    mockAdminReassign.mockResolvedValue({ ok: true, changed: 1 });

    const response = await PATCH(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 78,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "  Mentor handover requested  ",
        }),
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, changed: 1 });
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "teacher@example.com" } },
      "admin_mapping_mutation",
      { schoolCode: "SCH001", programId: 78 },
    );
    expect(mockAdminReassign).toHaveBeenCalledWith({
      actorEmail: "teacher@example.com",
      auditActorUserId: 19,
      schoolId: 4,
      programId: 78,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: 73,
      confirmed: true,
      reason: "Mentor handover requested",
    });
  });

  it.each([
    [{ confirmed: false }, "Reassignment confirmation is required"],
    [{ reason: "   " }, "Reassignment reason is required"],
    [{ academic_year: "2025-2026" }, "Admin Mapping reassignments are limited to the current Academic Year"],
    [{ student_id: null }, "Invalid Student"],
    [{ mentor_user_id: null }, "Invalid Mentor"],
    [{ expected_mapping_id: null }, "Invalid expected Mapping"],
  ] as const)("returns a client-actionable Admin reassign validation error", async (override, error) => {
    const response = await PATCH(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "Mentor handover",
          ...override,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockAdminReassign).not.toHaveBeenCalled();
  });

  it.each([
    [{}, "Program is required"],
    [{ program_id: null }, "Invalid Program"],
    [{ program_id: "" }, "Invalid Program"],
    [{ program_id: "1" }, "Invalid Program"],
    [{ program_id: 1.5 }, "Invalid Program"],
    [{ program_id: 999 }, "Invalid Program"],
  ])("requires one explicit unambiguous Program for Admin reassign", async (program, error) => {
    const response = await PATCH(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "Mentor handover",
          ...program,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockSession).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockAdminReassign).not.toHaveBeenCalled();
  });

  it("returns the existing current-ownership shape for a stale Admin reassignment", async () => {
    const ownership = [{
      studentId: 41,
      ownership: { mappingId: 74, mentorUserId: 8, mentorName: "Nila Sen" },
    }];
    mockAdminReassign.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Mapping ownership changed; review the refreshed roster",
      ownership,
    });

    const response = await PATCH(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          student_id: 41,
          mentor_user_id: 27,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "Mentor handover",
        }),
      }) as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Mapping ownership changed; review the refreshed roster",
      ownership,
    });
  });

  it.each([
    [{ confirmed: false }, "Removal confirmation is required"],
    [{ reason: "   " }, "Removal reason is required"],
    [{ academic_year: "2025-2026" }, "Admin Mapping removals are limited to the current Academic Year"],
  ] as const)("returns a client-actionable Admin remove validation error", async (override, error) => {
    const response = await DELETE(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          student_id: 41,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "Mentor left",
          ...override,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockAdminRemove).not.toHaveBeenCalled();
  });

  it.each([
    [{}, "Program is required"],
    [{ program_id: null }, "Invalid Program"],
    [{ program_id: "" }, "Invalid Program"],
    [{ program_id: "1" }, "Invalid Program"],
    [{ program_id: 1.5 }, "Invalid Program"],
    [{ program_id: 999 }, "Invalid Program"],
  ])("requires one explicit unambiguous Program for Admin remove", async (program, error) => {
    const response = await DELETE(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          student_id: 41,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "Mentor left",
          ...program,
        }),
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("returns refreshed ownership when Admin remove loses an ownership race", async () => {
    const ownership = [{
      studentId: 41,
      ownership: { mappingId: 74, mentorUserId: 8, mentorName: "Nila Sen" },
    }];
    mockAdminRemove.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Mapping ownership changed; review the refreshed roster",
      ownership,
    });

    const response = await DELETE(
      new Request("http://localhost/api/holistic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2026-2027",
          student_id: 41,
          expected_mapping_id: 73,
          confirmed: true,
          reason: "Mentor left",
        }),
      }) as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Mapping ownership changed; review the refreshed roster",
      ownership,
    });
  });

  it.each([
    ["GET", "http://localhost/api/holistic-mentorship/mappings?school_code=SCH001&academic_year=2025-2026"],
    ["POST", "http://localhost/api/holistic-mentorship/mappings"],
    ["DELETE", "http://localhost/api/holistic-mentorship/mappings"],
  ])("rejects non-current Academic Years for %s before authorization", async (method, url) => {
    const body = method === "POST"
      ? {
          school_code: "SCH001",
          program_id: 1,
          academic_year: "2025-2026",
          selections: [{ student_id: 41, expected_mapping_id: null }],
        }
      : method === "DELETE"
        ? {
            school_code: "SCH001",
            program_id: 1,
            academic_year: "2025-2026",
            confirmed: true,
            mappings: [{ student_id: 41, expected_mapping_id: 73 }],
          }
        : undefined;
    const request = new Request(url, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const response = method === "GET"
      ? await GET(request as never)
      : method === "POST"
        ? await POST(request as never)
        : await DELETE(request as never);

    expect(response.status).toBe(400);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockRoster).not.toHaveBeenCalled();
    expect(mockAssign).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
