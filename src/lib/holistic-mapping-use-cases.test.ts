import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockRoster, mockAssign, mockAdminReassign } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockRoster: vi.fn(),
  mockAssign: vi.fn(),
  mockAdminReassign: vi.fn(),
}));

vi.mock("@/lib/holistic-mentorship", () => ({
  requireHolisticMentorshipAccess: mockAccess,
}));
vi.mock("@/lib/holistic-mappings", () => ({
  listHolisticAssignmentRoster: mockRoster,
  assignHolisticMentees: mockAssign,
  reassignHolisticMenteeAsAdmin: mockAdminReassign,
}));

import {
  claimHolisticMappings,
  getHolisticMappingRoster,
  reassignHolisticMappingAsAdmin,
} from "./holistic-mapping-use-cases";

const session = { user: { email: "actor@example.com" } };
const permission = {
  email: "actor@example.com",
  level: 1,
  role: "teacher" as const,
  school_codes: ["SCH001"],
  program_ids: [1],
  user_id: 19,
};
const access = {
  ok: true as const,
  email: " Actor@Example.com ",
  actorUserId: 9,
  school: { id: 4, code: "SCH001" },
  permission,
  canEdit: true,
};

describe("Holistic mapping use cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(access);
  });

  it("authorizes and scopes roster reads before loading the roster", async () => {
    mockRoster.mockResolvedValue([]);
    const result = await getHolisticMappingRoster(session, {
      schoolCode: "SCH001",
      programId: 1,
      academicYear: "2026-2027",
      search: "asha",
      grade: 11,
    });

    expect(result).toEqual({ ok: true, actorUserId: 9, students: [] });
    expect(mockAccess).toHaveBeenCalledWith(session, "roster_view", {
      schoolCode: "SCH001",
      programId: 1,
    });
    expect(mockRoster).toHaveBeenCalledWith({
      permission,
      actorUserId: 9,
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      search: "asha",
      grade: 11,
    });
  });

  it("normalizes Teacher audit identity before claiming mappings", async () => {
    mockAssign.mockResolvedValue({ ok: true, changed: 1 });
    const result = await claimHolisticMappings(session, {
      schoolCode: "SCH001",
      programId: 1,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: null }],
    });

    expect(result).toEqual({ ok: true, changed: 1 });
    expect(mockAccess).toHaveBeenCalledWith(session, "mapping_mutation", {
      schoolCode: "SCH001",
      programId: 1,
    });
    expect(mockAssign).toHaveBeenCalledWith({
      actorUserId: 9,
      auditActorUserId: 19,
      actorEmail: "actor@example.com",
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      selections: [{ studentId: 41, expectedMappingId: null }],
    });
  });

  it("returns access denial without invoking a mutation", async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" });
    const result = await reassignHolisticMappingAsAdmin(session, {
      schoolCode: "SCH001",
      programId: 1,
      academicYear: "2026-2027",
      studentId: 41,
      mentorUserId: 27,
      expectedMappingId: 73,
      reason: "Mentor handover",
    });

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
    expect(mockAdminReassign).not.toHaveBeenCalled();
  });
});
