import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGuide, mockRedirect, mockRequireAccess } = vi.hoisted(
  () => ({
    mockGetServerSession: vi.fn(),
    mockGuide: vi.fn(({ audience }: { audience: string }) => <div>{audience} tutorial</div>),
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    mockRequireAccess: vi.fn(),
  }),
);

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({
  requireHolisticMentorshipAccess: mockRequireAccess,
}));
vi.mock("@/components/holistic-mentorship/HolisticMentorshipTutorial", () => ({
  default: mockGuide,
}));
vi.mock("@/components/PageHeader", () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import HolisticMentorshipTutorialPage from "./page";

describe("HolisticMentorshipTutorialPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedirect.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
  });

  it("redirects unauthenticated access", async () => {
    mockGetServerSession.mockResolvedValue(null);
    mockRequireAccess.mockResolvedValue({ ok: false, status: 401 });

    await expect(HolisticMentorshipTutorialPage()).rejects.toThrow("REDIRECT:/");
  });

  it("shows the Teacher guide after checking School access", async () => {
    const session = { user: { email: "teacher@example.com" } };
    mockGetServerSession.mockResolvedValue(session);
    mockRequireAccess.mockResolvedValue({ ok: true });

    render(await HolisticMentorshipTutorialPage({
      searchParams: Promise.resolve({ school_code: "SCH001" }),
    }));

    expect(screen.getByRole("heading", { name: "Holistic Mentorship Teacher guide" }))
      .toBeInTheDocument();
    expect(screen.getByText("teacher tutorial")).toBeInTheDocument();
    expect(mockRequireAccess).toHaveBeenCalledWith(
      session,
      "roster_view",
      { schoolCode: "SCH001" },
    );
  });

  it("shows the Admin guide after checking Program access", async () => {
    const session = { user: { email: "admin@example.com" } };
    mockGetServerSession.mockResolvedValue(session);
    mockRequireAccess.mockResolvedValue({ ok: true });

    render(await HolisticMentorshipTutorialPage());

    expect(screen.getByRole("heading", { name: "Holistic Mentorship Admin guide" }))
      .toBeInTheDocument();
    expect(screen.getByText("admin tutorial")).toBeInTheDocument();
    expect(mockRequireAccess).toHaveBeenCalledWith(session, "program_read", undefined);
  });
});
