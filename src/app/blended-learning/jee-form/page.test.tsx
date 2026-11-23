import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockCountNewFlags,
  mockListJeeFormRows,
  mockLoadDashboardChrome,
  mockJeeFormTab,
  mockRedirect,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockCountNewFlags: vi.fn(),
  mockListJeeFormRows: vi.fn(),
  mockLoadDashboardChrome: vi.fn(),
  mockJeeFormTab: vi.fn(),
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
vi.mock("@/lib/blended-learning-jee-form", () => ({ listJeeFormRows: mockListJeeFormRows }));
// JeeFormTab has its own tests; here only the props it gets matter.
vi.mock("./JeeFormTab", () => ({
  JeeFormTab: (props: Record<string, unknown>) => {
    mockJeeFormTab(props);
    return <div data-testid="jee-form-tab" />;
  },
}));

import JeeFormPage from "./page";

const MENTOR = { kind: "mentor", role: "blended_mentor", readOnly: false, actorEmail: "mentor@example.org", mentorUserId: 9001 };
const READ_ONLY_ADMIN = { kind: "admin", role: "blended_admin", readOnly: true, actorEmail: "viewer@example.org" };
const ADMIN = { ...READ_ONLY_ADMIN, readOnly: false, actorEmail: "admin@example.org" };
const ROWS = [{ studentId: 501, programStudentId: "0501", name: "Asha Testcase", mentorUserId: 9001, mentorName: "Mentor Alpha" }];

function signedInAs(access: { actorEmail: string }) {
  mockGetServerSession.mockResolvedValue({ user: { email: access.actorEmail } });
  mockGetBlendedLearningAccess.mockResolvedValue(access);
}

describe("JeeFormPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadDashboardChrome.mockResolvedValue(null);
    mockCountNewFlags.mockResolvedValue(2);
    mockListJeeFormRows.mockResolvedValue(ROWS);
  });

  it("gives a Mentor the JEE Form tab, open, with their own Students to record", async () => {
    signedInAs(MENTOR);

    render(await JeeFormPage());

    expect(screen.getByRole("heading", { level: 1, name: "JEE Form" })).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Mentor views" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "My Students",
      "JEE Form",
      "Flags2 new",
      "Resources",
    ]);
    expect(within(tabs).getByRole("link", { name: "JEE Form" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "JEE Form" })).toHaveAttribute("href", "/blended-learning/jee-form");
    expect(mockListJeeFormRows).toHaveBeenCalledWith(MENTOR);
    expect(mockJeeFormTab).toHaveBeenCalledWith({ rows: ROWS, canRecord: true, canReveal: true, showMentor: false });
  });

  it.each([
    ["an admin", ADMIN, true],
    ["a read-only admin", READ_ONLY_ADMIN, false],
  ] as const)("gives %s every Mentor's Students with the Mentor filter, view only (reveal: %s)", async (_who, access, canReveal) => {
    signedInAs(access);

    render(await JeeFormPage());

    const tabs = screen.getByRole("navigation", { name: "Admin views" });
    expect(within(tabs).getByRole("link", { name: "JEE Form" })).toHaveAttribute("aria-current", "page");
    expect(mockJeeFormTab).toHaveBeenCalledWith({ rows: ROWS, canRecord: false, canReveal, showMentor: true });
  });

  it("says the form can't be shown when the rows can't be read, without logging what failed", async () => {
    signedInAs(MENTOR);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockListJeeFormRows.mockRejectedValue(Object.assign(new Error("relation does not exist"), { name: "DatabaseError" }));

    render(await JeeFormPage());

    expect(screen.getByText("The JEE form can't be shown right now.")).toBeInTheDocument();
    expect(mockJeeFormTab).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Failed to load the JEE Form tab:", "DatabaseError");
    error.mockRestore();
  });

  it("sends a signed-out visitor to sign in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(JeeFormPage()).rejects.toThrow(/REDIRECT/);
    expect(mockListJeeFormRows).not.toHaveBeenCalled();
  });
});
