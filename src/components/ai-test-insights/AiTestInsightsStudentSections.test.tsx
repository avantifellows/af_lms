import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiTestInsightsStudentSections from "./AiTestInsightsStudentSections";
import type { AiTestInsightsStudentCardData, InsightRequestView } from "@/lib/ai-test-insights-shared";

// The Student page's cards around one read of the test picker route (#559):
// the Student card's newest test line and the AI Summary card's picker come
// from the same response. Session Notes (#575) links the request the AI
// Summary card shows, and a submit refreshes the page (the router is
// stubbed). History (#576) shows for everyone, from the same read of the
// sessions route as Session Notes. fetch is stubbed with hand-written replies.
const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
const CARD: AiTestInsightsStudentCardData = {
  name: "Esha Ekka",
  studentCode: "STU1005",
  grade: 11,
  batches: ["JNV Nodal 11"],
  gender: null,
  category: null,
  stream: "engineering",
  insightSessionsCompleted: 0,
  lastInsightSessionDate: null,
};

const TESTS = [
  { id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" },
  { id: "T4", name: "Major Test 2", date: "2026-10-12", format: "major_test" },
];

type Reply = { status: number; body: unknown };

/** What the Session Notes read answers a Teacher with no draft. */
const NO_DRAFT: Reply = { status: 200, body: { timeline: [], draft: null, notesAccess: "write" } };

/** Replies to writes, by method and route: Generate's create, a draft save, a submit. */
let writeReplies: Record<string, Reply>;
/** Replies to reads of the sessions route, in turn; once they run out, `NO_DRAFT`. */
let sessionsReplies: Reply[];

/**
 * Stubs fetch, answering each read of the test picker route with the next
 * reply (the last repeats), each write from `writeReplies`, each read of the
 * sessions route from `sessionsReplies`, and every other read (the AI Summary
 * text) with `NO_DRAFT`. Returns the picker route's calls.
 */
function stubFetch(...replies: Reply[]) {
  let call = 0;
  const pickerCalls = vi.fn();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    let reply = NO_DRAFT;
    const write = init?.method ? writeReplies[`${init.method} ${url.split("?")[0]}`] : undefined;
    if (write) {
      reply = write;
    } else if (url.split("?")[0].endsWith("/sessions")) {
      reply = sessionsReplies.shift() ?? NO_DRAFT;
    } else if (url.endsWith("/tests")) {
      pickerCalls(url);
      reply = replies[Math.min(call++, replies.length - 1)];
    }
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return pickerCalls;
}

const newestTestLine = () => {
  const card = screen.getByRole("region", { name: "Student" });
  return within(card).getByText("Newest test").nextElementSibling?.textContent;
};
const summary = () => screen.getByRole("region", { name: "AI Summary" });

function renderSections(canEdit = true, centreId: number | null = null, latestRequest: InsightRequestView | null = null) {
  render(
    <AiTestInsightsStudentSections
      student={CARD}
      studentId={1005}
      canEdit={canEdit}
      centreId={centreId}
      latestRequest={latestRequest}
    >
      <section aria-label="Performance" />
    </AiTestInsightsStudentSections>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  mockRefresh.mockReset();
  writeReplies = {};
  sessionsReplies = [];
});

writeReplies = {};
sessionsReplies = [];

/** A completed request of Major Test 2, asked for at 11:00 on 27 Nov 2026 in India. */
const COMPLETED: InsightRequestView = {
  requestKey: "req-completed-1005",
  state: "completed",
  outcomeCode: null,
  selectedTestIds: ["T4"],
  requestedAt: "2026-11-27T05:30:00Z",
  requestedByName: "Asha Teacher",
  finishedAt: "2026-11-27T05:34:00Z",
};
const notes = () => screen.getByRole("region", { name: "Session Notes" });
const history = () => screen.getByRole("region", { name: "History" });
const SESSIONS_ROUTE = "/api/ai-test-insights/students/1005/sessions";
/** The reads of the sessions route so far. */
const sessionsReads = () =>
  vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).split("?")[0] === SESSIONS_ROUTE && !init?.method);

/** A timeline of one Test Insight entry: `COMPLETED`, which the page also shows in the card. */
const WITH_COMPLETED: Reply = {
  status: 200,
  body: { timeline: [{ kind: "test_insight", testInsight: COMPLETED }], draft: null, notesAccess: "write" },
};

describe("AiTestInsightsStudentSections", () => {
  it("reads the Student's tests once and shows them in the picker and the newest test line", async () => {
    const fetchMock = stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections();

    expect(await within(summary()).findByRole("checkbox", { name: /Mock Test 1/ })).toBeChecked();
    expect(within(summary()).getByRole("checkbox", { name: /Major Test 2/ })).not.toBeChecked();
    expect(newestTestLine()).toBe("Mock Test 1 · 2 Nov 2026");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/ai-test-insights/students/1005/tests");
  });

  it("puts the Student card first, the other cards next, then the AI Summary card, Session Notes and History", async () => {
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections();

    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions).toEqual(["Student", "Performance", "AI Summary", "Session Notes", "History"]);
    await within(summary()).findAllByRole("checkbox");
  });

  it("puts History right after the AI Summary card for a viewer", async () => {
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections(false);

    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions).toEqual(["Student", "Performance", "AI Summary", "History"]);
    await within(summary()).findAllByRole("checkbox");
  });

  it("reads the sessions route once for Session Notes and History", async () => {
    sessionsReplies = [WITH_COMPLETED];
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections(true, 302);

    expect(await within(history()).findByText("AI Summary of 27 Nov 2026")).toBeInTheDocument();
    expect(await within(notes()).findByLabelText("Areas of concern")).toBeInTheDocument();
    // The History names the tests from the page's one picker read.
    expect(await within(history()).findByText("Made from: Major Test 2")).toBeInTheDocument();
    expect(sessionsReads().map(([url]) => url)).toEqual([`${SESSIONS_ROUTE}?centre=302`]);
  });

  it("keeps the AI Summary card and Session Notes' section when the read fails, and History's Retry reads again", async () => {
    const user = userEvent.setup();
    sessionsReplies = [{ status: 500, body: { error: "Session Notes could not be loaded" } }, WITH_COMPLETED];
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections();

    expect(await within(history()).findByRole("alert")).toHaveTextContent("History could not be loaded.");
    expect(await within(summary()).findByRole("checkbox", { name: /Mock Test 1/ })).toBeChecked();

    await user.click(within(history()).getByRole("button", { name: "Retry" }));

    expect(await within(history()).findByText("AI Summary of 27 Nov 2026")).toBeInTheDocument();
    expect(await within(notes()).findByLabelText("Areas of concern")).toBeInTheDocument();
    expect(sessionsReads()).toHaveLength(2);
  });

  it("reads Session Notes through the history route with the page's centre", async () => {
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections(true, 302);

    const notes = screen.getByRole("region", { name: "Session Notes" });
    expect(await within(notes).findByLabelText("Areas of concern")).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/ai-test-insights/students/1005/sessions?centre=302",
      expect.objectContaining({ cache: "no-store" }),
    );
    await within(summary()).findAllByRole("checkbox");
  });

  it("shows a viewer no Session Notes section; the one sessions read is History's", async () => {
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections(false);

    await within(summary()).findAllByRole("checkbox");
    expect(await within(history()).findByText("No Insight Sessions or AI Summaries yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Session Notes" })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url)).sort()).toEqual([
      SESSIONS_ROUTE,
      "/api/ai-test-insights/students/1005/tests",
    ]);
  });

  it("shows a dash on the newest test line when the Student has no test", async () => {
    stubFetch({ status: 200, body: { tests: [] } });
    renderSections();

    expect(
      await within(summary()).findByText("This student has no submitted Major, Full Syllabus or Mock test this year."),
    ).toBeInTheDocument();
    expect(newestTestLine()).toBe("—");
  });

  it('shows "unavailable" and "Tests could not be loaded" when the read fails, and Retry reads again', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      { status: 502, body: { error: "Tests could not be loaded" } },
      { status: 200, body: { tests: TESTS } },
    );
    renderSections();

    expect(await within(summary()).findByRole("alert")).toHaveTextContent("Tests could not be loaded");
    expect(newestTestLine()).toBe("unavailable");

    await user.click(within(summary()).getByRole("button", { name: "Retry" }));
    expect(await within(summary()).findByRole("checkbox", { name: /Mock Test 1/ })).toBeChecked();
    expect(newestTestLine()).toBe("Mock Test 1 · 2 Nov 2026");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a network failure as a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    renderSections();

    expect(await within(summary()).findByRole("alert")).toHaveTextContent("Tests could not be loaded");
    expect(newestTestLine()).toBe("unavailable");
  });

  it("shows a viewer the picker read-only", async () => {
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections(false);

    const checkboxes = await within(summary()).findAllByRole("checkbox");
    for (const checkbox of checkboxes) expect(checkbox).toBeDisabled();
  });
  describe("Session Notes and the AI Summary card", () => {
    it("links the completed request the card shows on load", async () => {
      stubFetch({ status: 200, body: { tests: TESTS } });
      renderSections(true, null, COMPLETED);

      expect(await within(notes()).findByText("Linked to the AI Summary of 27 Nov 2026")).toBeInTheDocument();
      await within(summary()).findAllByRole("checkbox");
    });

    it("follows the card: once Generate shows a queued request, nothing is linked", async () => {
      const user = userEvent.setup();
      writeReplies = {
        "POST /api/ai-test-insights/students/1005/requests": {
          status: 201,
          body: {
            outcome: "created",
            request: { ...COMPLETED, requestKey: "req-new", state: "queued", selectedTestIds: ["T9"], finishedAt: null },
          },
        },
      };
      stubFetch({ status: 200, body: { tests: TESTS } });
      renderSections(true, null, COMPLETED);
      await within(notes()).findByText("Linked to the AI Summary of 27 Nov 2026");

      await user.click(await within(summary()).findByRole("button", { name: "Generate" }));

      expect(
        await within(notes()).findByText("No AI Summary is open, so these notes won't be linked to one."),
      ).toBeInTheDocument();
    });

    it("refreshes the page after a submit, so the Student card's counts move", async () => {
      const user = userEvent.setup();
      writeReplies = {
        "PUT /api/ai-test-insights/students/1005/sessions/draft": { status: 200, body: { revision: 1 } },
        "POST /api/ai-test-insights/students/1005/sessions": { status: 201, body: { sessionId: 90, revision: 2 } },
      };
      stubFetch({ status: 200, body: { tests: TESTS } });
      renderSections(true, null, COMPLETED);

      await user.type(await within(notes()).findByLabelText("Areas of concern"), "Weak in optics");
      await user.type(within(notes()).getByLabelText("Immediate actions"), "Two worksheets");
      await user.click(within(notes()).getByRole("button", { name: "Submit" }));

      await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/ai-test-insights/students/1005/sessions",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("reads the timeline again after a submit, and shows the new entry", async () => {
      const user = userEvent.setup();
      writeReplies = {
        "PUT /api/ai-test-insights/students/1005/sessions/draft": { status: 200, body: { revision: 1 } },
        "POST /api/ai-test-insights/students/1005/sessions": { status: 201, body: { sessionId: 90, revision: 2 } },
      };
      const submitted = {
        kind: "session",
        sessionId: 90,
        revision: 2,
        sessionDate: "2026-11-20",
        authorName: "Asha Teacher",
        isAuthor: true,
        areasOfConcern: "Weak in optics",
        immediateActions: "Two worksheets",
        otherNotes: null,
        lastEditedAt: null,
        testInsight: COMPLETED,
      };
      sessionsReplies = [NO_DRAFT, { status: 200, body: { timeline: [submitted], draft: null, notesAccess: "write" } }];
      stubFetch({ status: 200, body: { tests: TESTS } });
      renderSections(true, null, COMPLETED);
      expect(await within(history()).findByText("No Insight Sessions or AI Summaries yet.")).toBeInTheDocument();

      await user.type(await within(notes()).findByLabelText("Areas of concern"), "Weak in optics");
      await user.type(within(notes()).getByLabelText("Immediate actions"), "Two worksheets");
      await user.click(within(notes()).getByRole("button", { name: "Submit" }));

      expect(await within(history()).findByText("20 Nov 2026")).toBeInTheDocument();
      expect(within(history()).getByText("AI Summary of 27 Nov 2026")).toBeInTheDocument();
      expect(sessionsReads()).toHaveLength(2);
    });

    it("reads the timeline again once the card's request becomes completed", async () => {
      const user = userEvent.setup();
      writeReplies = {
        "POST /api/ai-test-insights/students/1005/requests": { status: 200, body: { outcome: "existing", request: COMPLETED } },
      };
      sessionsReplies = [NO_DRAFT, WITH_COMPLETED];
      stubFetch({ status: 200, body: { tests: TESTS } });
      renderSections();
      expect(await within(history()).findByText("No Insight Sessions or AI Summaries yet.")).toBeInTheDocument();
      expect(sessionsReads()).toHaveLength(1);

      await user.click(await within(summary()).findByRole("button", { name: "Generate" }));

      expect(await within(history()).findByText("AI Summary of 27 Nov 2026")).toBeInTheDocument();
      expect(sessionsReads()).toHaveLength(2);
    });

    it("does not read the timeline again for a request that was completed on load", async () => {
      stubFetch({ status: 200, body: { tests: TESTS } });
      renderSections(true, null, COMPLETED);

      await within(summary()).findAllByRole("checkbox");
      await within(notes()).findByLabelText("Areas of concern");
      expect(sessionsReads()).toHaveLength(1);
    });

    it("keeps the form and its typing when a later read fails", async () => {
      const user = userEvent.setup();
      writeReplies = {
        "PUT /api/ai-test-insights/students/1005/sessions/draft": { status: 200, body: { revision: 1 } },
        "POST /api/ai-test-insights/students/1005/requests": { status: 200, body: { outcome: "existing", request: COMPLETED } },
      };
      sessionsReplies = [NO_DRAFT, { status: 500, body: { error: "Session Notes could not be loaded" } }];
      stubFetch({ status: 200, body: { tests: TESTS } });
      renderSections();
      await user.type(await within(notes()).findByLabelText("Areas of concern"), "Weak in optics");

      await user.click(await within(summary()).findByRole("button", { name: "Generate" }));

      expect(await within(history()).findByRole("alert")).toHaveTextContent("History could not be loaded.");
      expect(within(notes()).getByLabelText("Areas of concern")).toHaveValue("Weak in optics");
      expect(within(notes()).queryByRole("alert")).not.toBeInTheDocument();
      expect(await within(notes()).findByText("Linked to the AI Summary of 27 Nov 2026")).toBeInTheDocument();
      await user.type(within(notes()).getByLabelText("Immediate actions"), "Two worksheets");
      expect(within(notes()).getByRole("button", { name: "Submit" })).toBeEnabled();
    });
  });
});
