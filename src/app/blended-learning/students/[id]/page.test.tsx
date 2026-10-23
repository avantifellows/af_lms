import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MenteeDetail } from "@/lib/blended-learning-mentee-detail";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockGetMenteeDetail,
  mockGetDraftStatus,
  mockDraftStatus,
  mockRedirect,
  mockNotFound,
  mockLoadDashboardChrome,
} = vi.hoisted(() => ({
  mockLoadDashboardChrome: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockGetMenteeDetail: vi.fn(),
  mockGetDraftStatus: vi.fn(),
  mockDraftStatus: vi.fn(),
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
vi.mock("@/lib/blended-learning-mentee-detail", () => ({ getMenteeDetail: mockGetMenteeDetail }));
vi.mock("@/lib/blended-learning-drafts", () => ({ getDraftStatus: mockGetDraftStatus }));
vi.mock("@/lib/dashboard-chrome", () => ({ loadDashboardChrome: mockLoadDashboardChrome }));
// DraftStatus polls and has its own tests; here only the props it gets matter.
vi.mock("./DraftStatus", () => ({
  DraftStatus: (props: Record<string, unknown>) => {
    mockDraftStatus(props);
    return <div data-testid="draft-status" />;
  },
}));

import MenteeDetailPage from "./page";

const MENTOR = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", actorUserId: 9001, mentorUserId: 9001,
};
const BLENDED_ADMIN = {
  kind: "admin", role: "blended_admin", readOnly: false,
  actorEmail: "juned@avantifellows.org", actorUserId: 12,
};
const READ_ONLY_ADMIN = { ...BLENDED_ADMIN, readOnly: true, actorEmail: "viewer@avantifellows.org" };

const MENTEE: MenteeDetail = {
  studentId: 501,
  name: "Ira Sharma",
  gender: "Female",
  grade: 12,
  programName: "STP Voucher Delhi",
  phone: "+91 98765 43210",
  whatsappPhone: null,
  profileDocUrl: null,
  screenerUrl: null,
  openDraft: null,
  history: [],
  openActionItems: [],
  mentor: { userId: 9001, firstName: "Faizan" },
};

type Conversation = Extract<MenteeDetail["history"][number], { kind: "conversation" }>;

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    kind: "conversation", id: 12, occurredOn: "2026-10-20", mode: "call", spokeWith: "student", durationMinutes: 20,
    summary: "Planned the week.", hasNotes: false, hasRecording: false, hasTranscript: false, photoCount: 0,
    actionItems: [], flags: [],
    ...overrides,
  };
}

function signedInAs(access: { actorEmail: string }) {
  mockGetServerSession.mockResolvedValue({ user: { email: access.actorEmail } });
  mockGetBlendedLearningAccess.mockResolvedValue(access);
}

function renderPage(id = "501", from?: string) {
  return MenteeDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ from }) }).then((page) =>
    render(page)
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMenteeDetail.mockResolvedValue(MENTEE);
  mockGetDraftStatus.mockResolvedValue(null);
  mockLoadDashboardChrome.mockResolvedValue(null);
  // ConversationPhotos loads its photos as it mounts.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ photos: [] }))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MenteeDetailPage", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("REDIRECT:/");
  });

  it("shows the not-found page for a non-numeric id, without reading", async () => {
    signedInAs(MENTOR);
    await expect(renderPage("abc")).rejects.toThrow("NOT_FOUND");
    expect(mockGetMenteeDetail).not.toHaveBeenCalled();
  });

  it("shows the not-found page for a Mentee out of scope", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue(null);

    await expect(renderPage("601")).rejects.toThrow("NOT_FOUND");
    expect(mockGetMenteeDetail).toHaveBeenCalledWith(MENTOR, 601);
    expect(mockGetDraftStatus).not.toHaveBeenCalled();
  });

  it("shows a Mentor the name, profile line, contact and links, with the way to log", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({
      ...MENTEE,
      whatsappPhone: "91234 56789",
      profileDocUrl: "https://docs.example/ira",
      screenerUrl: "https://forms.example/screener",
    });

    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Ira Sharma" })).toBeInTheDocument();
    expect(screen.getByText("Grade 12")).toBeInTheDocument();
    expect(screen.getByText("STP Voucher Delhi")).toBeInTheDocument();
    expect(screen.getByText("Female")).toBeInTheDocument();
    const contact = screen.getByRole("region", { name: "Contact" });
    expect(within(contact).getByRole("link", { name: "+91 98765 43210" })).toHaveAttribute("href", "tel:+91 98765 43210");
    expect(within(contact).getByText("WhatsApp 91234 56789")).toBeInTheDocument();
    const profileDoc = screen.getByRole("link", { name: "Profile doc (opens in a new tab)" });
    expect(profileDoc).toHaveAttribute("href", "https://docs.example/ira");
    expect(profileDoc).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Screener form (opens in a new tab)" })).toHaveAttribute(
      "href",
      "https://forms.example/screener"
    );
    expect(screen.getByRole("link", { name: "Log conversation" })).toHaveAttribute(
      "href",
      "/blended-learning/students/501/log"
    );
    expect(screen.getByRole("link", { name: "Back to students" })).toHaveAttribute("href", "/blended-learning");
    expect(screen.queryByText(/Mentee/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("draft-status")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Open Action Items" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Conversations (0)" })).toBeInTheDocument();
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByText("Log the first one to start this student's history.")).toBeInTheDocument();
  });

  it("shows a sparse profile without a grade, contact number or links", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({
      ...MENTEE, grade: null, programName: null, gender: null, phone: null, screenerUrl: "https://forms.example/s",
    });

    await renderPage();

    expect(screen.queryByText(/Grade/)).not.toBeInTheDocument();
    expect(screen.getByText("No contact number")).toBeInTheDocument();
    expect(screen.queryByText(/WhatsApp/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Profile doc/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Screener form/ })).toBeInTheDocument();
  });

  it("gives a Mentor an open draft they can manage and review, with its retry offer", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, openDraft: { id: 41, state: "failed" } });
    mockGetDraftStatus.mockResolvedValue({ id: 41, state: "failed", retryOffered: true });

    await renderPage();

    expect(mockGetDraftStatus).toHaveBeenCalledWith(MENTOR, 41);
    expect(mockDraftStatus).toHaveBeenCalledWith({
      draftId: 41,
      initialState: "failed",
      initialRetryOffered: true,
      canManage: true,
      reviewHref: "/blended-learning/students/501/log",
    });
  });

  it("keeps a Mentor's way back to their own list, whatever the link says they came from", async () => {
    signedInAs(MENTOR);

    await renderPage("501", "flags");

    expect(screen.getByRole("link", { name: "Back to students" })).toHaveAttribute("href", "/blended-learning");
    expect(mockLoadDashboardChrome).toHaveBeenCalledWith(MENTOR);
  });

  it.each([
    ["no origin", undefined],
    ["an unknown origin", "elsewhere"],
  ])("sends an admin with %s back to the Student's Mentor's list", async (_case, from) => {
    signedInAs(BLENDED_ADMIN);

    await renderPage("501", from);

    expect(screen.getByRole("link", { name: "Back to Faizan's students" })).toHaveAttribute(
      "href",
      "/blended-learning/mentors/9001"
    );
    expect(screen.queryByRole("link", { name: "Back to students" })).not.toBeInTheDocument();
  });

  it("sends an admin who came from the Flags tab back to it", async () => {
    signedInAs(BLENDED_ADMIN);

    await renderPage("501", "flags");

    expect(screen.getByRole("link", { name: "Back to flags" })).toHaveAttribute("href", "/blended-learning?tab=flags");
  });

  it("shows an LMS admin the Student inside the dashboard, Blended Learning tab selected", async () => {
    const access = { ...BLENDED_ADMIN, role: "admin", actorEmail: "admin@avantifellows.org" };
    signedInAs(access);
    mockLoadDashboardChrome.mockResolvedValue({
      email: "admin@avantifellows.org",
      permission: { email: "admin@avantifellows.org", level: 3, role: "admin" },
      totalCount: 0,
      features: { hasPMAccess: true, canViewVisitSummary: false, showCurriculumSummary: false, canViewHolisticAdmin: false },
      view: "centres",
      showViews: true,
    });

    await renderPage();

    expect(mockLoadDashboardChrome).toHaveBeenCalledWith(access);
    expect(screen.getByRole("banner")).toHaveTextContent("Admin access");
    expect(screen.queryByText("Blended Learning Admin")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Blended Learning" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Physical Centres" })).toHaveAttribute("href", "/dashboard?view=centres");
    expect(screen.getByRole("heading", { level: 1, name: "Ira Sharma" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Faizan's students" })).toBeInTheDocument();
  });

  // Every Blended Learning Admin is view only, read-only or not.
  it.each([
    ["a Blended Learning Admin", BLENDED_ADMIN],
    ["an LMS admin", { ...BLENDED_ADMIN, role: "admin" }],
    ["a read-only Blended Learning Admin", READ_ONLY_ADMIN],
  ])("shows %s the draft without controls or the way to log", async (_case, access) => {
    signedInAs(access);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, openDraft: { id: 41, state: "ready" } });

    await renderPage();

    // The status read found nothing, so no retry is offered.
    expect(mockDraftStatus).toHaveBeenCalledWith({
      draftId: 41,
      initialState: "ready",
      initialRetryOffered: false,
      canManage: false,
      reviewHref: null,
    });
    // The Mentor's layout, view only: Log conversation stays in place, disabled.
    expect(screen.queryByRole("link", { name: "Log conversation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log conversation" })).toBeDisabled();
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.queryByText(/Log the first one/)).not.toBeInTheDocument();
  });

  it("lists Open Action Items with their owner and when they were agreed, never a due date", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({
      ...MENTEE,
      openActionItems: [
        { id: 120, text: "Revise optics", owner: "student", dueOn: "2026-10-27", agreedOn: "2026-10-20" },
      ],
    });

    await renderPage();

    const section = screen.getByRole("region", { name: "Open Action Items" });
    expect(within(section).getByText("Student")).toBeInTheDocument();
    expect(within(section).getByText("Revise optics")).toBeInTheDocument();
    expect(within(section).getByText("From 20 Oct 2026")).toBeInTheDocument();
    expect(within(section).queryByText(/Due/)).not.toBeInTheDocument();
  });

  it("shows the history newest first: Attempts with their note, Conversations with labelled sections", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({
      ...MENTEE,
      history: [
        conversation({
          id: 12,
          mode: "in_person",
          spokeWith: "both",
          durationMinutes: 35,
          hasNotes: true,
          hasRecording: true,
          hasTranscript: true,
          photoCount: 2,
          actionItems: [
            { id: 120, text: "Revise optics", owner: "student", dueOn: "2026-10-27", status: "open" },
            { id: 121, text: "Share notes", owner: "mentor", dueOn: null, status: "done" },
          ],
          flags: [
            { recipient: "emotional_wellbeing", comment: "Seemed anxious" },
            { recipient: "physics", comment: null },
          ],
        }),
        { kind: "attempt", id: 11, occurredOn: "2026-10-18", note: "No answer" },
        { kind: "attempt", id: 10, occurredOn: "2026-10-17", note: null },
      ],
    });

    await renderPage();

    const history = screen.getByRole("region", { name: "History" });
    // Only Conversations count; Attempts are still listed.
    expect(within(history).getByRole("heading", { level: 2, name: "Conversations (1)" })).toBeInTheDocument();
    const entries = within(history).getAllByRole("article");
    expect(entries).toHaveLength(3);

    const latest = within(entries[0]);
    expect(latest.getByRole("heading", { level: 3, name: "20 Oct 2026" })).toBeInTheDocument();
    expect(latest.getByText("In person · 35 min · Spoke with student and parent")).toBeInTheDocument();
    expect(latest.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual([
      "Summary",
      "Action items",
      "Photos",
      "Flag note for Shalini",
    ]);
    expect(latest.getByText("Planned the week.")).toBeInTheDocument();
    const items = within(latest.getByRole("list", { name: "Action Items" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["StudentRevise opticsOpen", "MentorShare notesDone"]);
    expect(items[0]).not.toHaveTextContent(/Due/);
    expect(latest.getByText("Share notes")).toHaveClass("line-through");
    // Flags are chips in the entry header; only commented flags get a note.
    const chips = within(latest.getByRole("list", { name: "Mentor Flags" })).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Flagged to Shalini", "Flagged to Physics teacher"]);
    expect(latest.getByRole("list", { name: "Mentor Flags" }).closest("header")).not.toBeNull();
    expect(latest.getByText("Seemed anxious")).toBeInTheDocument();
    expect(latest.queryByText(/Flag note for the Physics teacher/)).not.toBeInTheDocument();
    expect(latest.getByText("Loading photos…")).toBeInTheDocument();
    expect(latest.getByRole("button", { name: "Show notes" })).toBeInTheDocument();
    // A Mentor never gets the Call Recording.
    expect(latest.queryByRole("region", { name: "Call Recording" })).not.toBeInTheDocument();

    const attempt = within(entries[1]);
    expect(attempt.getByRole("heading", { level: 3, name: "18 Oct 2026" })).toBeInTheDocument();
    expect(attempt.getByText("Attempt")).toBeInTheDocument();
    expect(attempt.getByText("Not reachable")).toBeInTheDocument();
    expect(attempt.getByText("No answer")).toBeInTheDocument();
    // An Attempt without a note shows only its header.
    expect(entries[2].querySelectorAll("p")).toHaveLength(1);
  });

  it("shows a plain Conversation with None agreed and no flag, photo or notes sections", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, history: [conversation()] });

    await renderPage();

    const entry = within(screen.getByRole("article"));
    expect(entry.getByText("Call · 20 min · Spoke with student")).toBeInTheDocument();
    expect(entry.getByRole("heading", { level: 4, name: "Action items" })).toBeInTheDocument();
    expect(entry.getByText("None agreed.")).toBeInTheDocument();
    expect(entry.queryByRole("list", { name: "Action Items" })).not.toBeInTheDocument();
    expect(entry.queryByRole("list", { name: "Mentor Flags" })).not.toBeInTheDocument();
    expect(entry.queryByRole("heading", { name: "Photos" })).not.toBeInTheDocument();
    expect(entry.queryByText(/Flag note/)).not.toBeInTheDocument();
    expect(entry.queryByText("Loading photos…")).not.toBeInTheDocument();
    expect(entry.queryByRole("button", { name: "Show notes" })).not.toBeInTheDocument();
  });

  it("gives a Blended Learning Admin the recording or transcript of a Conversation that has one", async () => {
    signedInAs(BLENDED_ADMIN);
    mockGetMenteeDetail.mockResolvedValue({
      ...MENTEE,
      history: [
        conversation({ id: 14, hasTranscript: true }),
        conversation({ id: 13, hasRecording: true }),
        conversation({ id: 12 }),
      ],
    });

    await renderPage();

    const [transcriptOnly, recordingOnly, neither] = screen.getAllByRole("article").map((article) => within(article));
    expect(transcriptOnly.getByRole("button", { name: "Show transcript" })).toBeInTheDocument();
    expect(transcriptOnly.queryByRole("button", { name: "Play recording" })).not.toBeInTheDocument();
    expect(recordingOnly.getByRole("button", { name: "Play recording" })).toBeInTheDocument();
    expect(recordingOnly.queryByRole("button", { name: "Show transcript" })).not.toBeInTheDocument();
    expect(neither.queryByRole("region", { name: "Call Recording" })).not.toBeInTheDocument();
  });
});
