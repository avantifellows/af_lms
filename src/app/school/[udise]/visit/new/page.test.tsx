import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const {
  mockGetServerSession,
  mockGetResolvedPermission,
  mockGetFeatureAccess,
  mockCanAccessSchool,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetResolvedPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockCanAccessSchool: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({
  getResolvedPermission: mockGetResolvedPermission,
  getFeatureAccess: mockGetFeatureAccess,
  canAccessSchool: mockCanAccessSchool,
}));
vi.mock("@/components/visits/NewVisitForm", () => ({
  __esModule: true,
  default: ({ udise }: { udise: string }) => (
    <div data-testid="new-visit-form" data-udise={udise}>
      NewVisitForm
    </div>
  ),
}));

import NewVisitPage from "./page";

// ---- helpers ----

const pmSession = {
  user: { email: "pm@avantifellows.org" },
};

const makeParams = (udise: string) => Promise.resolve({ udise });

// ---- tests ----

describe("NewVisitPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(
      NewVisitPage({ params: makeParams("12345") })
    ).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockGetResolvedPermission).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(
      NewVisitPage({ params: makeParams("12345") })
    ).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to / when user has no visit edit access", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetResolvedPermission.mockResolvedValue({ level: 1 });
    mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: false });

    await expect(
      NewVisitPage({ params: makeParams("12345") })
    ).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockGetResolvedPermission).toHaveBeenCalledWith(
      "pm@avantifellows.org"
    );
    expect(mockGetFeatureAccess).toHaveBeenCalledWith({ level: 1 }, "visits");
    expect(mockCanAccessSchool).not.toHaveBeenCalled();
  });

  it("redirects to school page when user cannot access the school", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetResolvedPermission.mockResolvedValue({ level: 2 });
    mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
    mockCanAccessSchool.mockResolvedValue(false);

    await expect(
      NewVisitPage({ params: makeParams("67890") })
    ).rejects.toThrow("REDIRECT:/school/67890");
    expect(mockRedirect).toHaveBeenCalledWith("/school/67890");
    expect(mockCanAccessSchool).toHaveBeenCalledWith(
      "pm@avantifellows.org",
      "67890"
    );
  });

  it("renders NewVisitForm when all checks pass", async () => {
    mockGetServerSession.mockResolvedValue(pmSession);
    mockGetResolvedPermission.mockResolvedValue({ level: 3 });
    mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
    mockCanAccessSchool.mockResolvedValue(true);

    const jsx = await NewVisitPage({ params: makeParams("54321") });
    render(jsx);

    const form = screen.getByTestId("new-visit-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-udise", "54321");
  });

  it("renders for a Program Admin whose Visit access comes from a Centre seat", async () => {
    const resolvedPermission = {
      email: "program-admin@avantifellows.org",
      level: 1,
      role: "program_admin",
      program_ids: [],
      scope: {
        schools: new Set(["54321"]),
        centres: new Set([10]),
        programs: new Set([1]),
      },
    };
    mockGetServerSession.mockResolvedValue({
      user: { email: resolvedPermission.email },
    });
    mockGetResolvedPermission.mockResolvedValue(resolvedPermission);
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockCanAccessSchool.mockResolvedValue(true);

    const jsx = await NewVisitPage({ params: makeParams("54321") });
    render(jsx);

    expect(mockGetFeatureAccess).toHaveBeenCalledWith(
      resolvedPermission,
      "visits"
    );
    expect(screen.getByTestId("new-visit-form")).toBeInTheDocument();
  });
});
