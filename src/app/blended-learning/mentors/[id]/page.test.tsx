import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockListMentees,
  mockListMentorCards,
  mockRedirect,
  mockNotFound,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockListMentees: vi.fn(),
  mockListMentorCards: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: mockGetBlendedLearningAccess,
}));
vi.mock("@/lib/blended-learning-mentees", () => ({
  listMentees: mockListMentees,
  listMentorCards: mockListMentorCards,
}));
vi.mock("@/lib/curriculum-date-helpers", () => ({ getTodayIST: () => "2026-10-22" }));

import MentorPage from "./page";

const MENTOR = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", actorUserId: 9001, mentorUserId: 9001,
};
const BLENDED_ADMIN = {
  kind: "admin", role: "blended_admin", readOnly: false,
  actorEmail: "juned@avantifellows.org", actorUserId: 12,
};
const READ_ONLY_ADMIN = { ...BLENDED_ADMIN, readOnly: true, actorEmail: "viewer@avantifellows.org" };

const CARDS = [
  { mentorUserId: 9001, name: "Faizan", assigned: 30, grade12: 18, grade13: 12, talkedLast7: 9, notSpoken30Plus: 4 },
  { mentorUserId: 9002, name: "Lokesh", assigned: 1, grade12: 1, grade13: 0, talkedLast7: 0, notSpoken30Plus: 1 },
];

const MENTEE = {
  studentId: 501, name: "Ira Attempt", gender: "Female", grade: 12, programId: 80,
  programName: "STP Voucher Delhi", lastContact: "2026-10-12", lastContactSource: "conversation",
  latestEntryKind: "attempt", openDraftState: "ready", reasons: ["attempt"], daysSince: 10,
};

function signedInAs(access: { actorEmail: string }) {
  mockGetServerSession.mockResolvedValue({ user: { email: access.actorEmail } });
  mockGetBlendedLearningAccess.mockResolvedValue(access);
}

function renderPage(id = "9001") {
  return MentorPage({ params: Promise.resolve({ id }) }).then((page) => render(page));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListMentorCards.mockResolvedValue(CARDS);
  mockListMentees.mockResolvedValue({ talkToFirst: [MENTEE], everyoneElse: [] });
});

describe("MentorPage", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("REDIRECT:/");
  });

  it("sends a Mentor back to their own Mentee list", async () => {
    signedInAs(MENTOR);
    await expect(renderPage()).rejects.toThrow("REDIRECT:/blended-learning");
    expect(mockListMentorCards).not.toHaveBeenCalled();
  });

  it("shows the not-found page for a non-numeric id", async () => {
    signedInAs(BLENDED_ADMIN);
    await expect(renderPage("faizan")).rejects.toThrow("NOT_FOUND");
    expect(mockListMentorCards).not.toHaveBeenCalled();
  });

  it("shows the not-found page for a Mentor with no active Mappings", async () => {
    signedInAs(BLENDED_ADMIN);

    await expect(renderPage("9999")).rejects.toThrow("NOT_FOUND");
    expect(mockListMentorCards).toHaveBeenCalledWith(BLENDED_ADMIN, "2026-10-22");
    expect(mockListMentees).not.toHaveBeenCalled();
  });

  it("shows a Blended Learning Admin one Mentor's grouped Student list, with a ready draft to review", async () => {
    signedInAs(BLENDED_ADMIN);

    await renderPage();

    expect(mockListMentees).toHaveBeenCalledWith({ access: BLENDED_ADMIN, mentorUserId: 9001, today: "2026-10-22" });
    expect(screen.getByRole("heading", { level: 1, name: "Faizan" })).toBeInTheDocument();
    expect(screen.getByText("30 students · 2026-2027")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mentors/ })).toHaveAttribute("href", "/blended-learning");
    expect(screen.getByRole("rowgroup", { name: "Talk to first" })).toHaveTextContent("Ira Attempt");
    for (const link of screen.getAllByRole("link", { name: "Draft ready to review" })) {
      expect(link).toHaveAttribute("href", "/blended-learning/students/501/log");
    }
  });

  it("counts one Mentee in the singular and gives a read-only admin no way to review the draft", async () => {
    signedInAs(READ_ONLY_ADMIN);

    await renderPage("9002");

    expect(screen.getByRole("heading", { name: "Lokesh" })).toBeInTheDocument();
    expect(screen.getByText("1 student · 2026-2027")).toBeInTheDocument();
    expect(screen.getByRole("rowgroup", { name: "Talk to first" })).toHaveTextContent("Ira Attempt");
    expect(screen.getAllByText("Draft ready to review").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Draft ready to review" })).not.toBeInTheDocument();
  });

  it("never tells an admin about \"you\" talking to the Mentor's Students", async () => {
    signedInAs(BLENDED_ADMIN);

    await renderPage();

    const group = screen.getByRole("rowgroup", { name: "Talk to first" });
    expect(group).toHaveTextContent("Not reachable on the last try, or no conversation in 30 days or more.");
    expect(screen.getByRole("main")).not.toHaveTextContent(/\byou\b/i);
  });
});
