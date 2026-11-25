import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockCountNewFlags,
  mockListResources,
  mockListCommonActionItems,
  mockListTargetMentors,
  mockListTeamLeadLinks,
  mockListBlendedMentorOptions,
  mockLoadDashboardChrome,
  mockRedirect,
} = vi.hoisted(() => ({
  mockListTeamLeadLinks: vi.fn(),
  mockListBlendedMentorOptions: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockCountNewFlags: vi.fn(),
  mockListResources: vi.fn(),
  mockListCommonActionItems: vi.fn(),
  mockListTargetMentors: vi.fn(),
  mockLoadDashboardChrome: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: mockGetBlendedLearningAccess,
}));
vi.mock("@/lib/blended-learning-flags", () => ({ countNewFlags: mockCountNewFlags }));
vi.mock("@/lib/blended-learning-resources", () => ({ listResources: mockListResources }));
vi.mock("@/lib/blended-learning-common-action-items", () => ({
  listCommonActionItems: mockListCommonActionItems,
  listTargetMentors: mockListTargetMentors,
}));
vi.mock("@/lib/blended-learning-team-leads", () => ({
  listTeamLeadLinks: mockListTeamLeadLinks,
  listBlendedMentorOptions: mockListBlendedMentorOptions,
}));
vi.mock("@/lib/dashboard-chrome", () => ({ loadDashboardChrome: mockLoadDashboardChrome }));

import ManagePage from "./page";

const ADMIN = { kind: "admin", role: "blended_admin", readOnly: false, actorEmail: "juned@avantifellows.org" };
const LMS_ADMIN = { ...ADMIN, role: "admin", actorEmail: "admin@avantifellows.org" };
const READ_ONLY_ADMIN = { ...ADMIN, readOnly: true };
const MENTOR = {
  kind: "mentor",
  role: "blended_mentor",
  readOnly: false,
  actorEmail: "faizan@avantifellows.org",
  mentorUserId: 9001,
};

function signedInAs(access: typeof ADMIN | typeof MENTOR | null) {
  mockGetServerSession.mockResolvedValue(access ? { user: { email: access.actorEmail } } : null);
  mockGetBlendedLearningAccess.mockResolvedValue(access);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadDashboardChrome.mockResolvedValue(null);
  mockCountNewFlags.mockResolvedValue(0);
  mockListResources.mockResolvedValue([{ id: 1, title: "Mentor Toolkit", url: "https://example.org/toolkit" }]);
  mockListCommonActionItems.mockResolvedValue([]);
  mockListTargetMentors.mockResolvedValue([{ userId: 77, name: "Faizan Khan", students: 3 }]);
  mockListTeamLeadLinks.mockResolvedValue([
    {
      id: 4,
      teamLead: { userId: 78, name: "Synthetic Lead", email: "lead@test.local" },
      reportee: { userId: 77, name: "Synthetic Reportee", email: "reportee@test.local" },
      startedOn: "2026-11-12",
      endsOn: null,
    },
  ]);
  mockListBlendedMentorOptions.mockResolvedValue([
    { userId: 78, name: "Synthetic Lead", email: "lead@test.local" },
    { userId: 77, name: "Synthetic Reportee", email: "reportee@test.local" },
  ]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 3 }))));
});

describe("ManagePage", () => {
  it.each([
    ["a Blended Learning Admin", ADMIN],
    ["an LMS admin", LMS_ADMIN],
  ])("gives %s Resources and Program action items under the Manage tab", async (_who, access) => {
    signedInAs(access);

    render(await ManagePage());

    const tabs = screen.getByRole("navigation", { name: "Admin views" });
    expect(within(tabs).getByRole("link", { name: "Manage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "Manage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Resources" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Program action items" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mentor Toolkit (opens in a new tab)" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "New program action item" })).toBeInTheDocument();
    expect(mockListCommonActionItems).toHaveBeenCalledWith(access);
    expect(mockListTargetMentors).toHaveBeenCalledWith(access);
    // Team leads: who leads whom, and a form to add one.
    expect(screen.getByRole("heading", { level: 2, name: "Team leads" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Team leads" })).getByRole("listitem")).toHaveTextContent(
      "Synthetic LeadleadsSynthetic Reportee"
    );
    expect(screen.getByRole("form", { name: "Add a team lead" })).toBeInTheDocument();
    expect(mockListTeamLeadLinks).toHaveBeenCalledWith(access);
    expect(mockListBlendedMentorOptions).toHaveBeenCalledWith(access);
  });

  it.each([
    ["a Mentor", MENTOR],
    ["a read-only admin", READ_ONLY_ADMIN],
  ])("sends %s back to the section's landing", async (_who, access) => {
    signedInAs(access);

    await expect(ManagePage()).rejects.toThrow("REDIRECT:/blended-learning");
    expect(mockListResources).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign-in", async () => {
    signedInAs(null);
    await expect(ManagePage()).rejects.toThrow("REDIRECT:/");
  });
});
