import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockCountNewFlags,
  mockListResources,
  mockLoadDashboardChrome,
  mockRedirect,
} =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockGetBlendedLearningAccess: vi.fn(),
    mockCountNewFlags: vi.fn(),
    mockListResources: vi.fn(),
    mockLoadDashboardChrome: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: mockGetBlendedLearningAccess,
}));
vi.mock("@/lib/blended-learning-flags", () => ({ countNewFlags: mockCountNewFlags }));
vi.mock("@/lib/dashboard-chrome", () => ({ loadDashboardChrome: mockLoadDashboardChrome }));
vi.mock("@/lib/blended-learning-resources", () => ({ listResources: mockListResources }));

import ResourcesPage from "./page";

const MENTOR = {
  kind: "mentor",
  role: "blended_mentor",
  readOnly: false,
  actorEmail: "faizan@avantifellows.org",
 
  mentorUserId: 9001,
};
const BLENDED_ADMIN = {
  kind: "admin",
  role: "blended_admin",
  readOnly: true,
  actorEmail: "juned@avantifellows.org",
 
};
const MANAGING_ADMIN = { ...BLENDED_ADMIN, readOnly: false };
const TOOLKIT = "Mentor Toolkit: Supporting Students Through Non-Academic Stress (opens in a new tab)";
const RESOURCES = [
  {
    id: 1,
    title: "Mentor Toolkit: Supporting Students Through Non-Academic Stress",
    url: "https://docs.google.com/document/d/1kST-wRFTWgczw7SqBAxW97KNyJ0fzuBoOBsIelTQ8W0/edit?usp=sharing",
  },
  { id: 4, title: "Exam stress guide", url: "https://example.org/exam-stress" },
];

function signedInAs(access: typeof MENTOR | typeof BLENDED_ADMIN | typeof MANAGING_ADMIN) {
  mockGetServerSession.mockResolvedValue({ user: { email: access.actorEmail } });
  mockGetBlendedLearningAccess.mockResolvedValue(access);
}

describe("ResourcesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadDashboardChrome.mockResolvedValue(null);
    mockCountNewFlags.mockResolvedValue(3);
    mockListResources.mockResolvedValue(RESOURCES);
  });

  it("sends a signed-out visitor to sign-in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(ResourcesPage()).rejects.toThrow("REDIRECT:/");
  });

  it("gives a Mentor the Resources tab after My Students and Flags, each resource opening in a new tab", async () => {
    signedInAs(MENTOR);

    render(await ResourcesPage());

    const tabs = screen.getByRole("navigation", { name: "Mentor views" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["My Students", "Flags3 new", "Resources"]);
    expect(within(tabs).getByRole("link", { name: "My Students" })).toHaveAttribute("href", "/blended-learning");
    expect(within(tabs).getByRole("link", { name: "Resources" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "Resources" })).toBeInTheDocument();
    const link = within(screen.getByRole("list", { name: "Resources" })).getByRole("link", { name: TOOLKIT });
    expect(link).toHaveAttribute(
      "href",
      "https://docs.google.com/document/d/1kST-wRFTWgczw7SqBAxW97KNyJ0fzuBoOBsIelTQ8W0/edit?usp=sharing"
    );
    expect(link).toHaveAttribute("target", "_blank");
    // In the order admins set on the Manage page.
    expect(
      within(screen.getByRole("list", { name: "Resources" }))
        .getAllByRole("link")
        .map((item) => item.textContent)
    ).toEqual(["Mentor Toolkit: Supporting Students Through Non-Academic Stress", "Exam stress guide"]);
    expect(mockCountNewFlags).toHaveBeenCalledWith(MENTOR);
  });

  it("says so when there are no resources", async () => {
    signedInAs(MENTOR);
    mockListResources.mockResolvedValue([]);

    render(await ResourcesPage());

    expect(screen.getByText("No resources yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Resources" })).not.toBeInTheDocument();
  });

  it("adds the Manage tab for an admin who may manage", async () => {
    signedInAs(MANAGING_ADMIN);

    render(await ResourcesPage());

    const tabs = screen.getByRole("navigation", { name: "Admin views" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Mentors",
      "Flags3 new",
      "Resources",
      "Manage",
    ]);
    expect(within(tabs).getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/blended-learning/manage");
  });

  it("gives an admin, read-only too, the same resources as a tab after Mentors and Flags", async () => {
    signedInAs(BLENDED_ADMIN);

    render(await ResourcesPage());

    const tabs = screen.getByRole("navigation", { name: "Admin views" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["Mentors", "Flags3 new", "Resources"]);
    expect(within(tabs).getByRole("link", { name: "Resources" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: TOOLKIT })).toBeInTheDocument();
  });
});
