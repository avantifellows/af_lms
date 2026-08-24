import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockPageHeader, mockRedirect, mockRequireAccess, mockWorkspace } = vi.hoisted(
  () => ({
    mockGetServerSession: vi.fn(),
    mockPageHeader: vi.fn(({ title, actions }: { title: string; actions?: ReactNode }) => (
      <><h1>{title}</h1>{actions}</>
    )),
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    mockRequireAccess: vi.fn(),
    mockWorkspace: vi.fn(() => <div><button role="tab">Students & Progress</button><button role="tab">Phase Setup</button></div>),
  })
);

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/holistic-mentorship", () => ({
  requireHolisticMentorshipAccess: mockRequireAccess,
}));
vi.mock("@/components/PageHeader", () => ({
  default: mockPageHeader,
}));
vi.mock("@/components/holistic-mentorship/HolisticMentorshipWorkspace", () => ({
  default: mockWorkspace,
}));

import HolisticMentorshipAdminPage from "./page";

describe("HolisticMentorshipAdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });

  it("redirects unauthenticated direct access", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockRequireAccess.mockResolvedValue({ ok: false, status: 401 });
    await expect(HolisticMentorshipAdminPage()).rejects.toThrow("REDIRECT:/");
  });

  it("rejects excluded roles", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "pm@example.com" } });
    mockRequireAccess.mockResolvedValue({ ok: false, status: 403 });
    await expect(HolisticMentorshipAdminPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("renders the Program-wide shell for an authorized Admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    mockRequireAccess.mockResolvedValue({ ok: true, permission: { role: "admin" } });

    render(await HolisticMentorshipAdminPage());

    expect(screen.getByRole("heading", { name: "Holistic Mentorship" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Students & Progress" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Phase Setup" })).toBeInTheDocument();
    expect(mockRequireAccess).toHaveBeenCalledWith(
      { user: { email: "admin@example.com" } },
      "program_read"
    );
    expect(mockPageHeader).toHaveBeenCalledWith(
      expect.objectContaining({ backHref: "/dashboard" }),
      undefined
    );
  });

  it.each(["admin", "holistic_mentorship_admin"] as const)(
    "keeps Phase Setup visible for a read-only %s",
    async (role) => {
      mockGetServerSession.mockResolvedValue({ user: { email: `${role}@example.com` } });
      mockRequireAccess.mockResolvedValue({
        ok: true,
        canEdit: false,
        programId: 1,
        programIds: [1, 78],
        permission: { role, read_only: true },
      });

      render(await HolisticMentorshipAdminPage());

      expect(mockWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "admin",
          canEdit: false,
          canViewPhaseSetup: true,
        }),
        undefined,
      );
    },
  );

  it("renders scoped Program Manager progress access read-only from the helper result", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "pm@example.com" } });
    mockRequireAccess.mockResolvedValue({
      ok: true,
      canEdit: false,
      programId: 78,
      programIds: [78],
      permission: { role: "program_manager" },
    });

    render(await HolisticMentorshipAdminPage());

    expect(mockWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "admin",
        canEdit: false,
        canViewPhaseSetup: false,
        initialProgramId: 78,
        availableProgramIds: [78],
      }),
      undefined,
    );
    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("does not link the dedicated Admin back to its redirecting dashboard", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "holistic@example.com" } });
    mockRequireAccess.mockResolvedValue({
      ok: true,
      permission: { role: "holistic_mentorship_admin" },
    });

    render(await HolisticMentorshipAdminPage());

    expect(mockPageHeader).toHaveBeenCalledWith(
      expect.objectContaining({ backHref: undefined }),
      undefined
    );
  });
});
