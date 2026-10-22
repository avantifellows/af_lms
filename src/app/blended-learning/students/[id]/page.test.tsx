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
} = vi.hoisted(() => ({
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

function renderPage(id = "501") {
  return MenteeDetailPage({ params: Promise.resolve({ id }) }).then((page) => render(page));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMenteeDetail.mockResolvedValue(MENTEE);
  mockGetDraftStatus.mockResolvedValue(null);
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

  it("shows a Mentor the profile, contact and links, with the way to log", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({
      ...MENTEE,
      whatsappPhone: "91234 56789",
      profileDocUrl: "https://docs.example/ira",
      screenerUrl: "https://forms.example/screener",
    });

    await renderPage();

    expect(screen.getByRole("heading", { name: "Ira Sharma" })).toBeInTheDocument();
    expect(screen.getByText("Grade 12")).toBeInTheDocument();
    expect(screen.getByText("STP Voucher Delhi")).toBeInTheDocument();
    expect(screen.getByText("Female")).toBeInTheDocument();
    const contact = screen.getByRole("region", { name: "Contact" });
    expect(within(contact).getByRole("link", { name: "+91 98765 43210" })).toHaveAttribute("href", "tel:+91 98765 43210");
    expect(within(contact).getByText("WhatsApp 91234 56789")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile Doc" })).toHaveAttribute("href", "https://docs.example/ira");
    expect(screen.getByRole("link", { name: "Screener Link" })).toHaveAttribute("href", "https://forms.example/screener");
    expect(screen.getByRole("link", { name: "Log a Conversation or Attempt" })).toHaveAttribute(
      "href",
      "/blended-learning/students/501/log"
    );
    expect(screen.getByRole("link", { name: /Mentees/ })).toHaveAttribute("href", "/blended-learning");
    expect(screen.queryByTestId("draft-status")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Open Action Items" })).not.toBeInTheDocument();
    expect(screen.getByText("No Conversations or Attempts yet.")).toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: "Profile Doc" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Screener Link" })).toBeInTheDocument();
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

  it("shows a read-only admin the draft without controls or the way to log", async () => {
    signedInAs(READ_ONLY_ADMIN);
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
    expect(screen.queryByRole("link", { name: "Log a Conversation or Attempt" })).not.toBeInTheDocument();
  });

  it("lists Open Action Items with their owner, due date and when they were agreed", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({
      ...MENTEE,
      openActionItems: [
        { id: 120, text: "Revise optics", owner: "student", dueOn: "2026-10-27", agreedOn: "2026-10-20" },
      ],
    });

    await renderPage();

    const section = screen.getByRole("region", { name: "Open Action Items" });
    expect(within(section).getByText("Revise optics")).toBeInTheDocument();
    expect(within(section).getByText("Student · Due 27 Oct 2026 · From 20 Oct 2026")).toBeInTheDocument();
  });

  it("shows the history newest first: Attempts with their note, Conversations with items, flags and media", async () => {
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

    const entries = within(screen.getByRole("region", { name: "History" })).getAllByRole("article");
    expect(entries).toHaveLength(3);

    const latest = within(entries[0]);
    expect(latest.getByText("20 Oct 2026")).toBeInTheDocument();
    expect(latest.getByText("Conversation")).toBeInTheDocument();
    expect(latest.getByText("In person · Student and parent · 35 min")).toBeInTheDocument();
    expect(latest.getByText("Planned the week.")).toBeInTheDocument();
    const items = latest.getAllByRole("listitem").filter((item) => item.closest("ul")?.getAttribute("aria-label") === "Action Items");
    expect(items[0]).toHaveTextContent("Revise optics");
    expect(items[0]).toHaveTextContent("Open");
    expect(items[1]).toHaveTextContent("Done");
    expect(latest.getByText("Share notes")).toHaveClass("line-through");
    const flags = latest.getByRole("list", { name: "Mentor Flags" });
    expect(flags).toHaveTextContent("Emotional Well-being · Seemed anxious");
    expect(within(flags).getByText("Physics Teacher").parentElement).toHaveTextContent(/^Physics Teacher$/);
    expect(latest.getByText("Loading photos…")).toBeInTheDocument();
    expect(latest.getByRole("button", { name: "Show notes" })).toBeInTheDocument();
    // A Mentor never gets the Call Recording.
    expect(latest.queryByRole("region", { name: "Call Recording" })).not.toBeInTheDocument();

    expect(within(entries[1]).getByText("Attempt")).toBeInTheDocument();
    expect(within(entries[1]).getByText("No answer")).toBeInTheDocument();
    expect(within(entries[2]).getByText("No note")).toBeInTheDocument();
  });

  it("shows a plain Conversation without item, flag, photo or notes sections", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, history: [conversation()] });

    await renderPage();

    const entry = within(screen.getByRole("article"));
    expect(entry.getByText("Call · Student · 20 min")).toBeInTheDocument();
    expect(entry.queryByRole("list", { name: "Action Items" })).not.toBeInTheDocument();
    expect(entry.queryByRole("list", { name: "Mentor Flags" })).not.toBeInTheDocument();
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
