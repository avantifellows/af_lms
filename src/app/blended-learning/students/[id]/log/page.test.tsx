import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MenteeDetail } from "@/lib/blended-learning-mentee-detail";

const {
  mockGetServerSession,
  mockGetBlendedLearningAccess,
  mockGetMenteeDetail,
  mockGetDraftForReview,
  mockGetDraftStatus,
  mockListMentees,
  mockLogEntryForm,
  mockRedirect,
  mockNotFound,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetBlendedLearningAccess: vi.fn(),
  mockGetMenteeDetail: vi.fn(),
  mockGetDraftForReview: vi.fn(),
  mockGetDraftStatus: vi.fn(),
  mockListMentees: vi.fn(),
  mockLogEntryForm: vi.fn(),
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
vi.mock("@/lib/blended-learning-drafts", () => ({
  getDraftForReview: mockGetDraftForReview,
  getDraftStatus: mockGetDraftStatus,
}));
vi.mock("@/lib/blended-learning-mentees", () => ({ listMentees: mockListMentees }));
vi.mock("@/lib/curriculum-date-helpers", () => ({ getTodayIST: () => "2026-10-22" }));
// Only a Mentor reaches the form, and the Blended Learning roles have no dashboard chrome.
vi.mock("@/lib/dashboard-chrome", () => ({ loadDashboardChrome: async () => null }));
// The form has its own tests; here only what the page hands it matters. The
// stub renders the Last Conversation panel the page builds for it.
vi.mock("./LogEntryForm", () => ({
  LogEntryForm: (props: { lastConversationPanel: ReactNode }) => {
    mockLogEntryForm(props);
    return <div data-testid="log-entry-form">{props.lastConversationPanel}</div>;
  },
}));

import LogEntryPage from "./page";

const MENTOR = {
  kind: "mentor", role: "blended_mentor", readOnly: false,
  actorEmail: "faizan@avantifellows.org", mentorUserId: 9001,
};
const BLENDED_ADMIN = {
  kind: "admin", role: "blended_admin", readOnly: false,
  actorEmail: "juned@avantifellows.org",
};
const READ_ONLY_ADMIN = { ...BLENDED_ADMIN, readOnly: true, actorEmail: "viewer@avantifellows.org" };
const LMS_ADMIN = { ...BLENDED_ADMIN, role: "admin", actorEmail: "panchali@avantifellows.org" };
const READ_ONLY_MENTOR = { ...MENTOR, readOnly: true, actorEmail: "mentor-viewer@avantifellows.org" };

const OPEN_ITEMS = [{ id: 120, text: "Revise optics", owner: "student", agreedOn: "2026-10-12", source: "conversation" }];

const MENTEE: MenteeDetail = {
  studentId: 501,
  name: "Ira Sharma",
  gender: "Female",
  grade: 12,
  programName: "STP Voucher Delhi",
  phone: null,
  whatsappPhone: null,
  profileDocUrl: null,
  screenerUrl: null,
  screenerFeedbackDue: false,
  openDraft: null,
  history: [
    { kind: "attempt", id: 13, occurredOn: "2026-10-20", note: "No answer" },
    {
      kind: "conversation", id: 12, occurredOn: "2026-10-12", mode: "in_person", spokeWith: "parent_or_sibling",
      durationMinutes: 15, summary: "Spoke with her brother.", hasNotes: false, hasRecording: false,
      hasTranscript: false, photoCount: 0, actionItems: [], flags: [], screenerUsed: null, screenerFeedback: null,
    },
    {
      kind: "conversation", id: 11, occurredOn: "2026-10-01", mode: "call", spokeWith: "student",
      durationMinutes: 30, summary: "Older Conversation.", hasNotes: false, hasRecording: false,
      hasTranscript: false, photoCount: 0, actionItems: [], flags: [], screenerUsed: null, screenerFeedback: null,
    },
  ],
  openActionItems: OPEN_ITEMS as MenteeDetail["openActionItems"],
  mentor: { userId: 9001, firstName: "Faizan" },
};

function signedInAs(access: { actorEmail: string }) {
  mockGetServerSession.mockResolvedValue({ user: { email: access.actorEmail } });
  mockGetBlendedLearningAccess.mockResolvedValue(access);
}

function renderPage(id = "501") {
  return LogEntryPage({ params: Promise.resolve({ id }) }).then((page) => render(page));
}

function formProps() {
  return mockLogEntryForm.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMenteeDetail.mockResolvedValue(MENTEE);
  mockGetDraftForReview.mockResolvedValue(null);
  mockGetDraftStatus.mockResolvedValue(null);
  // Her latest entry is an Attempt, so she is in Talk to first.
  mockListMentees.mockResolvedValue({ talkToFirst: [{ studentId: 501, reasons: ["attempt"] }], everyoneElse: [] });
});

describe("LogEntryPage", () => {
  it("sends a signed-out visitor to sign-in", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow("REDIRECT:/");
  });

  it("shows the not-found page for a non-numeric id", async () => {
    signedInAs(MENTOR);
    await expect(renderPage("12abc")).rejects.toThrow("NOT_FOUND");
    expect(mockGetMenteeDetail).not.toHaveBeenCalled();
  });

  // Only a Mentor logs: every Blended Learning Admin is view only.
  it.each([
    ["a Blended Learning Admin", BLENDED_ADMIN],
    ["an LMS admin", LMS_ADMIN],
    ["a read-only Blended Learning Admin", READ_ONLY_ADMIN],
    ["a read-only Mentor", READ_ONLY_MENTOR],
  ])("sends %s back to the Mentee's detail page without reading", async (_case, access) => {
    signedInAs(access);
    await expect(renderPage()).rejects.toThrow("REDIRECT:/blended-learning/students/501");
    expect(mockGetMenteeDetail).not.toHaveBeenCalled();
  });

  it("shows the not-found page for a Mentee out of scope", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue(null);

    await expect(renderPage("601")).rejects.toThrow("NOT_FOUND");
    expect(mockGetMenteeDetail).toHaveBeenCalledWith(MENTOR, 601);
  });

  it("gives a Mentor the blank log form for their own Mentee, with the last Conversation beside it", async () => {
    signedInAs(MENTOR);

    await renderPage();

    expect(screen.getByRole("link", { name: "Back to Ira Sharma" })).toHaveAttribute(
      "href",
      "/blended-learning/students/501"
    );
    expect(mockGetDraftForReview).not.toHaveBeenCalled();
    expect(formProps()).toMatchObject({
      studentId: 501,
      name: "Ira Sharma",
      firstName: "Ira",
      subtitle: "Ira Sharma · Grade 12 · STP Voucher Delhi",
      today: "2026-10-22",
      listGroup: "Talk to first",
      openActionItems: OPEN_ITEMS,
      hasOpenDraft: false,
      draft: null,
    });
    // The newest Conversation, skipping the newer Attempt.
    const panel = screen.getByRole("region", { name: "Last Conversation" });
    expect(panel).toHaveTextContent("12 Oct 2026");
    expect(panel).toHaveTextContent("In person · 15 min · Spoke with parent or sibling");
    expect(panel).toHaveTextContent("Spoke with her brother.");
    expect(panel).not.toHaveTextContent("Older Conversation.");
  });

  describe("the Profile Doc's latest entry", () => {
    const PROFILE_DOC_ENTRY = {
      kind: "profile_doc" as const,
      id: 0 as const,
      occurredOn: "2026-09-17",
      summary: "Synthetic: planned the mocks.",
      actionItems: [{ id: 201, text: "Synthetic: revise optics", owner: "student" as const, status: "open" as const }],
      profileDocUrl: "https://docs.example/ira",
    };

    it("is the Last Conversation before the first one in the app", async () => {
      signedInAs(MENTOR);
      mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, history: [MENTEE.history[0], PROFILE_DOC_ENTRY] });

      await renderPage();

      const panel = screen.getByRole("region", { name: "Last Conversation" });
      expect(panel).toHaveTextContent("17 Sept 2026");
      expect(panel).toHaveTextContent("From Profile Doc");
      expect(panel).toHaveTextContent("Synthetic: planned the mocks.");
      expect(within(panel).getByRole("link", { name: "Open Profile Doc (opens in a new tab)" })).toHaveAttribute(
        "href",
        "https://docs.example/ira"
      );
      expect(panel).not.toHaveTextContent("No earlier Conversation");
      expect(screen.queryByRole("checkbox", { name: /Synthetic: revise optics/ })).not.toBeInTheDocument();
    });

    it("gives way to a newer Conversation in the app", async () => {
      signedInAs(MENTOR);
      mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, history: [...MENTEE.history, PROFILE_DOC_ENTRY] });

      await renderPage();

      const panel = screen.getByRole("region", { name: "Last Conversation" });
      expect(panel).not.toHaveTextContent("From Profile Doc");
      expect(panel).not.toHaveTextContent("Synthetic: planned the mocks.");
    });
  });

  it("asks about the screener only with a Screener link, and its questions while the feedback is due", async () => {
    signedInAs(MENTOR);
    await renderPage();
    expect(formProps()?.screener).toEqual({ hasLink: false, feedbackDue: false });

    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, screenerUrl: "https://forms.example/s", screenerFeedbackDue: true });
    await renderPage();
    expect(formProps()?.screener).toEqual({ hasLink: true, feedbackDue: true });
  });

  it("says there is no Conversation yet when the history has only Attempts", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, history: [MENTEE.history[0]] });

    await renderPage();

    expect(screen.getByRole("region", { name: "Last Conversation" })).toHaveTextContent(
      "No earlier Conversation. This will be the first one."
    );
  });

  it("passes a draft still being drafted to the form as pending, without reading it for review", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, openDraft: { id: 41, state: "transcribing" } });

    await renderPage();

    expect(mockGetDraftForReview).not.toHaveBeenCalled();
    expect(mockGetDraftStatus).toHaveBeenCalledWith(MENTOR, 41);
    expect(formProps()).toMatchObject({
      hasOpenDraft: true,
      draft: null,
      pendingDraft: { id: 41, state: "transcribing", retryOffered: false },
      canManageDraft: true,
    });
  });

  it("passes the Mentee's current list group, or none when the list has no row for them", async () => {
    signedInAs(MENTOR);
    mockListMentees.mockResolvedValueOnce({ talkToFirst: [], everyoneElse: [{ studentId: 501, reasons: [] }] });
    await renderPage();
    expect(mockListMentees).toHaveBeenCalledWith({ access: MENTOR, studentId: 501, today: "2026-10-22" });
    expect(formProps()).toMatchObject({ listGroup: "Everyone else" });

    mockListMentees.mockResolvedValueOnce({ talkToFirst: [], everyoneElse: [] });
    await renderPage();
    expect(formProps()).toMatchObject({ listGroup: null });
  });

  it("prefills a Mentor's form from a ready draft and its notes, leaving out its tags", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, openDraft: { id: 41, state: "ready" } });
    mockGetDraftForReview.mockResolvedValue({
      id: 41,
      occurredOn: "2026-10-21",
      mode: "call",
      spokeWith: "student",
      durationMinutes: 25,
      summary: "Talked about mock tests.",
      actionItems: [{ text: "Revise optics", owner: "student" }],
      notes: [{ heading: "Physics & Maths", points: ["<b>weak</b>"] }],
    });

    await renderPage();

    expect(mockGetDraftForReview).toHaveBeenCalledWith(MENTOR, 501);
    expect(formProps()).toMatchObject({
      hasOpenDraft: true,
      draft: {
        id: 41,
        occurredOn: "2026-10-21",
        mode: "call",
        spokeWith: "student",
        durationMinutes: 25,
        summary: "Talked about mock tests.",
        actionItems: [{ text: "Revise optics", owner: "student" }],
        notesHtml: "<h3>Physics &amp; Maths</h3><ul><li>&lt;b&gt;weak&lt;/b&gt;</li></ul>",
      },
      pendingDraft: null,
    });
  });

  it("opens a draft with no session details or notes", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, openDraft: { id: 41, state: "ready" } });
    mockGetDraftForReview.mockResolvedValue({
      id: 41, occurredOn: null, mode: null, spokeWith: null, durationMinutes: null,
      summary: "Short call.", actionItems: [], notes: [],
    });

    await renderPage();

    expect(formProps().draft).toMatchObject({ summary: "Short call.", notesHtml: "" });
  });

  it("falls back to the plain log form when the ready draft can no longer be read", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, openDraft: { id: 41, state: "ready" } });

    await renderPage();

    expect(mockGetDraftForReview).toHaveBeenCalledWith(MENTOR, 501);
    expect(formProps().draft).toBeNull();
  });

  it("uses the whole name as the first name when it has no first word", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, name: " Sharma" });

    await renderPage();

    expect(formProps().firstName).toBe(" Sharma");
  });

  it("leaves an unknown grade and program out of the subtitle", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, grade: null, programName: null });

    await renderPage();

    expect(formProps().subtitle).toBe("Ira Sharma");
  });

  it("passes a failed draft as pending with its retry offer", async () => {
    signedInAs(MENTOR);
    mockGetMenteeDetail.mockResolvedValue({ ...MENTEE, openDraft: { id: 41, state: "failed" } });
    mockGetDraftStatus.mockResolvedValue({ state: "failed", retryOffered: true });

    await renderPage();

    expect(formProps().pendingDraft).toEqual({ id: 41, state: "failed", retryOffered: true });
  });
});
