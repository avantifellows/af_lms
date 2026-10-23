import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetResolvedPermission, mockGetAccessibleSchoolCodes, mockRequireHolisticAccess } = vi.hoisted(() => ({
  mockGetResolvedPermission: vi.fn(),
  mockGetAccessibleSchoolCodes: vi.fn(),
  mockRequireHolisticAccess: vi.fn(),
}));

vi.mock("./permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions")>()),
  getResolvedPermission: mockGetResolvedPermission,
  getAccessibleSchoolCodes: mockGetAccessibleSchoolCodes,
}));
vi.mock("./holistic-mentorship", () => ({ requireHolisticMentorshipAccess: mockRequireHolisticAccess }));

import { loadDashboardChrome } from "./dashboard-chrome";
import type { BlendedLearningAccess } from "./blended-learning-access";

const LMS_ADMIN: BlendedLearningAccess = {
  kind: "admin",
  role: "admin",
  readOnly: false,
  actorEmail: "admin@test.local",
 
};

function permission(overrides: Record<string, unknown> = {}) {
  return {
    email: "admin@test.local",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: null,
    read_only: false,
    user_id: 1,
    scope: { schools: "all", centres: "all", visitManagedSchools: new Set() },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireHolisticAccess.mockResolvedValue({ ok: true });
  mockGetAccessibleSchoolCodes.mockResolvedValue(["SC1", "SC2"]);
});

describe("loadDashboardChrome", () => {
  it.each(["blended_mentor", "blended_admin"] as const)("gives a %s no chrome, without reading", async (role) => {
    expect(await loadDashboardChrome({ ...LMS_ADMIN, role })).toBeNull();
    expect(mockGetResolvedPermission).not.toHaveBeenCalled();
  });

  it("gives an LMS admin the dashboard's header and both views, Physical Centres by default", async () => {
    mockGetResolvedPermission.mockResolvedValue(permission());

    const chrome = await loadDashboardChrome(LMS_ADMIN);

    expect(chrome).toMatchObject({
      email: "admin@test.local",
      totalCount: 0,
      view: "centres",
      showViews: true,
      features: { hasPMAccess: true, canViewHolisticAdmin: true },
    });
    expect(mockGetAccessibleSchoolCodes).not.toHaveBeenCalled();
    expect(mockRequireHolisticAccess).toHaveBeenCalledWith({ user: { email: "admin@test.local" } }, "program_read");
  });

  it("counts a school-level user's schools for the header", async () => {
    mockGetResolvedPermission.mockResolvedValue(
      permission({ role: "program_manager", level: 1, school_codes: ["SC1", "SC2"], program_ids: [1] })
    );

    const chrome = await loadDashboardChrome({ ...LMS_ADMIN, role: "admin" });

    expect(chrome?.totalCount).toBe(2);
  });

  it.each([
    ["no permission", null],
    ["a PMU Govt School User", permission({ role: "pmu_govt_school_user", level: 1 })],
    ["a Holistic Mentorship Admin", permission({ role: "holistic_mentorship_admin", level: 1 })],
    ["no Programs", permission({ role: "program_manager", level: 1, program_ids: [] })],
  ])("gives no chrome for %s", async (_case, resolved) => {
    mockGetResolvedPermission.mockResolvedValue(resolved);

    expect(await loadDashboardChrome(LMS_ADMIN)).toBeNull();
  });
});
