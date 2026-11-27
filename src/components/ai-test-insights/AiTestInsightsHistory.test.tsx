import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AiTestInsightsHistory from "./AiTestInsightsHistory";
import type { SessionsRead } from "@/hooks/use-ai-test-insights-sessions";
import type { AiTestInsightsTestsState, InsightRequestView } from "@/lib/ai-test-insights-shared";
import type { TimelineEntry } from "@/lib/ai-test-insights-timeline";

// The History section of the AI Test Insights Student page (#576): the
// timeline the page's one read of the sessions route answered, in the order
// it came. Every date and line below is written by hand.
const MARKER = "[marker-576-history]";

const TESTS: AiTestInsightsTestsState = {
  status: "loaded",
  tests: [
    { id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" },
    { id: "T4", name: "Major Test 2", date: "2026-10-12", format: "major_test" },
  ],
};

/** Asked for at 10:30 on 14 Nov 2026 in India, of Mock Test 1 and a test the picker does not hold. */
const RECORDED: InsightRequestView = {
  requestKey: "rk-51",
  state: "completed",
  outcomeCode: null,
  selectedTestIds: ["T9", "T1"],
  requestedAt: "2026-11-14T05:00:00Z",
  requestedByName: "Asha Teacher",
  finishedAt: "2026-11-14T05:04:00Z",
};
/** Asked for at 00:30 on 11 Feb 2026 in India (18:30 UTC the day before). */
const UNRECORDED: InsightRequestView = {
  requestKey: "rk-52",
  state: "completed",
  outcomeCode: null,
  selectedTestIds: ["T4"],
  requestedAt: "2026-02-10T19:00:00Z",
  requestedByName: "Bina Teacher",
  finishedAt: "2026-02-10T19:05:00Z",
};

const TIMELINE: TimelineEntry[] = [
  {
    kind: "session",
    sessionId: 11,
    revision: 4,
    sessionDate: "2026-11-14",
    authorName: "Asha Teacher",
    isAuthor: true,
    areasOfConcern: `Weak in optics ${MARKER}`,
    immediateActions: `Two worksheets ${MARKER}`,
    otherNotes: `Parents informed ${MARKER}`,
    // 19:00 UTC on 15 Nov 2026 is 00:30 on 16 Nov 2026 in India.
    lastEditedAt: "2026-11-15T19:00:00Z",
    testInsight: RECORDED,
  },
  { kind: "test_insight", testInsight: UNRECORDED },
  {
    kind: "session",
    sessionId: 12,
    revision: 2,
    sessionDate: "2026-02-10",
    authorName: "Bina Teacher",
    isAuthor: false,
    areasOfConcern: `Misses classes ${MARKER}`,
    immediateActions: `Call home ${MARKER}`,
    otherNotes: null,
    lastEditedAt: null,
    testInsight: null,
  },
];

const loaded = (timeline: TimelineEntry[]): SessionsRead => ({
  state: { status: "loaded", sessions: { timeline, draft: null, notesAccess: "read" } },
  reload: vi.fn(),
});

const REQUESTS_URL = "/api/ai-test-insights/students/1001/requests";
/** The edit route of one session, as the page builds it with its centre. */
const sessionUrl = (sessionId: number) => `/api/ai-test-insights/students/1001/sessions/${sessionId}?centre=302`;

let onEdited: ReturnType<typeof vi.fn<() => void>>;

function renderHistory(
  sessions: SessionsRead,
  tests: AiTestInsightsTestsState = TESTS,
  requestsUrl: string = REQUESTS_URL,
) {
  onEdited = vi.fn();
  render(
    <AiTestInsightsHistory
      sessions={sessions}
      tests={tests}
      requestsUrl={requestsUrl}
      sessionUrl={sessionUrl}
      onEdited={onEdited}
    />,
  );
  return screen.getByRole("region", { name: "History" });
}

/** Each entry's lines of text, in the order shown. */
const entryLines = (history: HTMLElement) =>
  within(history)
    .getAllByRole("listitem")
    .map((item) => Array.from(item.querySelectorAll("h3, p, dt, dd")).map((line) => line.textContent));

describe("AiTestInsightsHistory", () => {
  it("shows each entry in the order given, with its notes and the Test Insight it records", () => {
    const history = renderHistory(loaded(TIMELINE));

    expect(within(history).getByRole("heading", { level: 2 })).toHaveTextContent("History");
    expect(entryLines(history)).toEqual([
      [
        "14 Nov 2026",
        "Notes by Asha Teacher",
        "Edited on 16 Nov 2026",
        "Areas of concern",
        `Weak in optics ${MARKER}`,
        "Immediate actions",
        `Two worksheets ${MARKER}`,
        "Other notes",
        `Parents informed ${MARKER}`,
        "AI Summary of 14 Nov 2026",
        "Made from: Mock Test 1, an earlier test",
        "Asked for by Asha Teacher on 14 Nov 2026, 10:30",
      ],
      ["AI Summary of 11 Feb 2026", "Made from: Major Test 2", "Asked for by Bina Teacher on 11 Feb 2026, 00:30"],
      [
        "10 Feb 2026",
        "Notes by Bina Teacher",
        "Areas of concern",
        `Misses classes ${MARKER}`,
        "Immediate actions",
        `Call home ${MARKER}`,
      ],
    ]);
  });

  it('shows "Edited on" only on an entry that was edited', () => {
    const history = renderHistory(loaded(TIMELINE));

    expect(within(history).getAllByText(/^Edited on/)).toHaveLength(1);
  });

  it("counts the tests while the picker's read has not answered", () => {
    const history = renderHistory(loaded(TIMELINE), { status: "failed" });

    expect(within(history).getByText("Made from: 2 tests")).toBeInTheDocument();
    expect(within(history).getByText("Made from: 1 test")).toBeInTheDocument();
  });

  it("says so when the Student has no entry", () => {
    const history = renderHistory(loaded([]));

    expect(within(history).getByText("No Insight Sessions or AI Summaries yet.")).toBeInTheDocument();
    expect(within(history).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("says it is loading while the read runs", () => {
    const history = renderHistory({ state: { status: "loading" }, reload: vi.fn() });

    expect(within(history).getByText("Loading history…")).toBeInTheDocument();
  });

  it("shows a failed read with Retry, which reads again", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const history = renderHistory({ state: { status: "failed" }, reload });

    expect(within(history).getByRole("alert")).toHaveTextContent("History could not be loaded.");
    await user.click(within(history).getByRole("button", { name: "Retry" }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// "View AI Summary" (#577): every Test Insight in the timeline opens in place
// through part 1's summary and PDF routes, with the page's centre. The text is
// read only once it is opened.
describe("AiTestInsightsHistory View AI Summary", () => {
  const MARKDOWN = "## Where Asha stands\n\n- Physics is improving\n\n| Subject | Score |\n| --- | --- |\n| Physics | 62 |\n";
  const summaryUrl = (requestKey: string) => `${REQUESTS_URL}/${requestKey}/summary`;
  const pdfUrl = (requestKey: string) => `${REQUESTS_URL}/${requestKey}/pdf`;

  /** Answers each summary read with the next of these; a number is a failed answer with that status. */
  function answerSummary(...answers: Array<string | number>) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => {
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (typeof next === "number") return Promise.resolve({ ok: false, status: next, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ markdown: next }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const askedUrls = (fetchMock: ReturnType<typeof answerSummary>) => fetchMock.mock.calls.map(([url]) => url);

  /** The timeline's entry (list item) whose text holds `text`. */
  const entryWith = (history: HTMLElement, text: string) =>
    within(history)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes(text))!;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["a Test Insight by itself", "AI Summary of 11 Feb 2026", "rk-52"],
    ["the Test Insight a session records", "Notes by Asha Teacher", "rk-51"],
  ] as const)("opens %s in place, formatted, and closes it again", async (_label, text, requestKey) => {
    const user = userEvent.setup();
    const fetchMock = answerSummary(MARKDOWN);
    const entry = entryWith(renderHistory(loaded(TIMELINE)), text);

    // Nothing is read before it is opened.
    expect(within(entry).queryByRole("article")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(entry).getByRole("button", { name: "View AI Summary" }));
    const article = await within(entry).findByRole("article", { name: "AI Summary text" });
    expect(within(article).getByRole("heading", { name: "Where Asha stands" })).toBeInTheDocument();
    expect(within(article).getByRole("table")).toBeInTheDocument();
    expect(within(entry).getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", pdfUrl(requestKey));
    expect(askedUrls(fetchMock)).toEqual([summaryUrl(requestKey)]);

    await user.click(within(entry).getByRole("button", { name: "Hide AI Summary" }));
    expect(within(entry).queryByRole("article")).not.toBeInTheDocument();
    expect(within(entry).queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
    expect(within(entry).getByRole("button", { name: "View AI Summary" })).toHaveAttribute("aria-expanded", "false");
  });

  it("offers View AI Summary on each Test Insight and on no session without one", () => {
    vi.stubGlobal("fetch", vi.fn());
    const history = renderHistory(loaded(TIMELINE));

    expect(within(history).getAllByRole("button", { name: "View AI Summary" })).toHaveLength(2);
    expect(
      within(entryWith(history, "Notes by Bina Teacher")).queryByRole("button", { name: "View AI Summary" }),
    ).not.toBeInTheDocument();
  });

  it("opens one entry without reading the other", async () => {
    const user = userEvent.setup();
    const fetchMock = answerSummary(MARKDOWN);
    const history = renderHistory(loaded(TIMELINE));

    await user.click(within(entryWith(history, "AI Summary of 11 Feb 2026")).getByRole("button", { name: "View AI Summary" }));
    await within(history).findByRole("article", { name: "AI Summary text" });

    expect(within(history).getAllByRole("article")).toHaveLength(1);
    expect(askedUrls(fetchMock)).toEqual([summaryUrl("rk-52")]);
  });

  it("carries the page's centre to the summary and PDF routes", async () => {
    const user = userEvent.setup();
    const fetchMock = answerSummary(MARKDOWN);
    const entry = entryWith(renderHistory(loaded(TIMELINE), TESTS, `${REQUESTS_URL}?centre=302`), "AI Summary of 11 Feb 2026");

    await user.click(within(entry).getByRole("button", { name: "View AI Summary" }));
    await within(entry).findByRole("article", { name: "AI Summary text" });

    expect(askedUrls(fetchMock)).toEqual([`${summaryUrl("rk-52")}?centre=302`]);
    expect(within(entry).getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `${pdfUrl("rk-52")}?centre=302`);
  });

  it('names the tests it was made from by the card\'s rule, "an earlier test" for one the picker does not hold', async () => {
    const user = userEvent.setup();
    answerSummary(MARKDOWN);
    const entry = entryWith(renderHistory(loaded(TIMELINE)), "Notes by Asha Teacher");

    await user.click(within(entry).getByRole("button", { name: "View AI Summary" }));
    await within(entry).findByRole("article", { name: "AI Summary text" });

    expect(within(entry).getByText("Made from: Mock Test 1, an earlier test")).toBeInTheDocument();
    expect(within(entry).getByText("Asked for by Asha Teacher on 14 Nov 2026, 10:30")).toBeInTheDocument();
  });

  it("says the text could not be loaded inside the entry, and Retry reads it again", async () => {
    const user = userEvent.setup();
    const fetchMock = answerSummary(502, MARKDOWN);
    const history = renderHistory(loaded(TIMELINE));
    const entry = entryWith(history, "AI Summary of 11 Feb 2026");

    await user.click(within(entry).getByRole("button", { name: "View AI Summary" }));
    const alert = await within(entry).findByRole("alert");
    expect(alert).toHaveTextContent("The AI Summary could not be loaded");
    expect(within(entry).getByRole("link", { name: "Download PDF" })).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await within(entry).findByRole("article", { name: "AI Summary text" })).toHaveTextContent("Where Asha stands");
    expect(within(history).queryByRole("alert")).not.toBeInTheDocument();
    expect(askedUrls(fetchMock)).toEqual([summaryUrl("rk-52"), summaryUrl("rk-52")]);
  });

  it("makes no call but the summary read once opened: no status poll, no wake, no enqueue", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:40:00Z") });
    const fetchMock = answerSummary(MARKDOWN);
    const entry = entryWith(renderHistory(loaded(TIMELINE)), "AI Summary of 11 Feb 2026");

    act(() => within(entry).getByRole("button", { name: "View AI Summary" }).click());
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(askedUrls(fetchMock)).toEqual([summaryUrl("rk-52")]);
  });

  describe("Download PDF", () => {
    const assign = vi.fn();
    const SIGNED_URL = "https://store.example.test/acad-mentorship/staging/items/41/output/report.pdf?X-Amz-Expires=60";

    /** The summary read answers the text; each PDF ask answers the next of these. */
    function answerPdf(...answers: Array<{ status: number; body: unknown }>) {
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url) => {
        if (url.endsWith("/summary")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ markdown: MARKDOWN }) });
        }
        const next = answers.length > 1 ? answers.shift()! : answers[0];
        return Promise.resolve({ ok: next.status === 200, status: next.status, json: () => Promise.resolve(next.body) });
      });
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("location", { ...window.location, assign });
      return fetchMock;
    }

    beforeEach(() => {
      assign.mockReset();
    });

    it("asks the PDF route with the entry's request key, then goes to the signed file", async () => {
      const user = userEvent.setup();
      const fetchMock = answerPdf({ status: 200, body: { url: SIGNED_URL } });
      const entry = entryWith(renderHistory(loaded(TIMELINE)), "Notes by Asha Teacher");
      await user.click(within(entry).getByRole("button", { name: "View AI Summary" }));
      await within(entry).findByRole("article", { name: "AI Summary text" });

      await user.click(within(entry).getByRole("link", { name: "Download PDF" }));

      await waitFor(() => expect(assign).toHaveBeenCalledWith(SIGNED_URL));
      expect(askedUrls(fetchMock)).toEqual([summaryUrl("rk-51"), pdfUrl("rk-51")]);
    });

    it("keeps the page after a failed download and says so, and Retry asks again", async () => {
      const user = userEvent.setup();
      const fetchMock = answerPdf({ status: 502, body: {} }, { status: 200, body: { url: SIGNED_URL } });
      const entry = entryWith(renderHistory(loaded(TIMELINE)), "AI Summary of 11 Feb 2026");
      await user.click(within(entry).getByRole("button", { name: "View AI Summary" }));
      await within(entry).findByRole("article", { name: "AI Summary text" });

      await user.click(within(entry).getByRole("link", { name: "Download PDF" }));
      const alert = await within(entry).findByRole("alert");
      expect(alert).toHaveTextContent("The PDF could not be downloaded. Please try again.");
      expect(assign).not.toHaveBeenCalled();
      await user.click(within(alert).getByRole("button", { name: "Retry" }));

      await waitFor(() => expect(assign).toHaveBeenCalledWith(SIGNED_URL));
      expect(askedUrls(fetchMock)).toEqual([summaryUrl("rk-52"), pdfUrl("rk-52"), pdfUrl("rk-52")]);
    });
  });
});

// Edit (#578): the author corrects their own submitted notes in place, with
// "Save changes" (no autosave) and Cancel, under the final rule. fetch is
// stubbed: each edit answers from `edits`, in turn, or 200 with the next
// revision once `edits` runs out. Today in India is 28 Nov 2026.
describe("AiTestInsightsHistory Edit", () => {
  type Reply = { status: number; body: unknown };
  type Deferred = { reply: Promise<Reply>; resolve: (reply: Reply) => void };
  let edits: Array<Reply | Deferred>;
  let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>>;

  const asResponse = (reply: Reply) => ({
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    json: () => Promise.resolve(reply.body),
  });
  function deferred(): Deferred {
    let resolve!: (reply: Reply) => void;
    const reply = new Promise<Reply>((res) => {
      resolve = res;
    });
    return { reply, resolve };
  }

  beforeEach(() => {
    // 19:00 UTC on 27 Nov is 00:30 on 28 Nov in India.
    vi.useFakeTimers({ now: new Date("2026-11-27T19:00:00Z"), toFake: ["setTimeout", "clearTimeout", "Date"] });
    edits = [];
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const next = edits.shift();
      if (next) return asResponse("reply" in next ? await next.reply : next);
      const { expectedRevision } = JSON.parse(String(init?.body)) as { expectedRevision: number };
      return asResponse({ status: 200, body: { revision: expectedRevision + 1 } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  /** The timeline's entry (list item) whose text holds `text`. */
  const entryWith = (history: HTMLElement, text: string) =>
    within(history)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes(text))!;
  const field = (entry: HTMLElement, label: string) =>
    within(entry).getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
  const type = (entry: HTMLElement, label: string, value: string) =>
    fireEvent.change(field(entry, label), { target: { value } });
  const saveButton = (entry: HTMLElement) => within(entry).getByRole("button", { name: "Save changes" });

  /** Asha's own entry (session 11, revision 4), with Edit pressed. */
  function editAshasEntry(sessions: SessionsRead = loaded(TIMELINE)) {
    const entry = entryWith(renderHistory(sessions), "Notes by Asha Teacher");
    fireEvent.click(within(entry).getByRole("button", { name: "Edit" }));
    return entry;
  }

  it("offers Edit only on the caller's own entries", () => {
    const history = renderHistory(loaded(TIMELINE));

    expect(within(history).getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(within(entryWith(history, "Notes by Asha Teacher")).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(entryWith(history, "Notes by Bina Teacher")).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("offers no Edit to a viewer, whose entries are never their own", () => {
    const viewerTimeline = TIMELINE.map((entry) => (entry.kind === "session" ? { ...entry, isAuthor: false } : entry));

    expect(within(renderHistory(loaded(viewerTimeline))).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("opens the four fields in place, filled with the entry's notes, with Save changes and Cancel", () => {
    const entry = editAshasEntry();

    expect(field(entry, "Date of conversation").value).toBe("2026-11-14");
    expect(field(entry, "Areas of concern").value).toBe(`Weak in optics ${MARKER}`);
    expect(field(entry, "Immediate actions").value).toBe(`Two worksheets ${MARKER}`);
    expect(field(entry, "Other notes (optional)").value).toBe(`Parents informed ${MARKER}`);
    expect(saveButton(entry)).toBeEnabled();
    expect(within(entry).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(entry).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("fills a blank Other notes as empty", () => {
    const entry = entryWith(renderHistory(loaded([{ ...TIMELINE[2], isAuthor: true } as TimelineEntry])), "Notes by Bina Teacher");
    fireEvent.click(within(entry).getByRole("button", { name: "Edit" }));

    expect(field(entry, "Other notes (optional)").value).toBe("");
  });

  it("saves nothing by itself: no autosave", async () => {
    const entry = editAshasEntry();

    type(entry, "Areas of concern", `Weak in ray optics ${MARKER}`);
    await tick(5_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("Save changes is off", () => {
    it.each([
      ["Areas of concern is blank", "Areas of concern", "  "],
      ["Immediate actions is blank", "Immediate actions", ""],
      ["the date is empty", "Date of conversation", ""],
      ["the date is after today in India", "Date of conversation", "2026-11-29"],
      ["a field is over the limit", "Other notes (optional)", "a".repeat(2001)],
    ])("while %s", (_label, label, value) => {
      const entry = editAshasEntry();

      type(entry, label, value);

      expect(saveButton(entry)).toBeDisabled();
    });

    it("says why when the date is after today, and turns on again for today in India", () => {
      const entry = editAshasEntry();

      type(entry, "Date of conversation", "2026-11-29");
      expect(within(entry).getByText("Date of conversation can't be after today.")).toBeInTheDocument();
      type(entry, "Date of conversation", "2026-11-28");

      expect(saveButton(entry)).toBeEnabled();
    });

    it("while a save is running", async () => {
      const pending = deferred();
      edits = [pending];
      const entry = editAshasEntry();

      fireEvent.click(saveButton(entry));
      await tick(0);
      expect(saveButton(entry)).toBeDisabled();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      pending.resolve({ status: 200, body: { revision: 5 } });
      await tick(0);
    });
  });

  it("puts the entry back as it was on Cancel and sends nothing", () => {
    const entry = editAshasEntry();
    type(entry, "Areas of concern", "Changed my mind");

    fireEvent.click(within(entry).getByRole("button", { name: "Cancel" }));

    expect(within(entry).queryByLabelText("Areas of concern")).not.toBeInTheDocument();
    expect(within(entry).getByText(`Weak in optics ${MARKER}`)).toBeInTheDocument();
    expect(within(entry).queryByText("Changed my mind")).not.toBeInTheDocument();
    fireEvent.click(within(entry).getByRole("button", { name: "Edit" }));
    expect(field(entry, "Areas of concern").value).toBe(`Weak in optics ${MARKER}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the four fields at the entry's revision to the session's edit route, then reads the timeline again", async () => {
    const sessions = loaded(TIMELINE);
    const entry = editAshasEntry(sessions);
    type(entry, "Date of conversation", "2026-11-13");
    type(entry, "Areas of concern", `  Weak in ray optics ${MARKER} `);
    type(entry, "Other notes (optional)", "");

    fireEvent.click(saveButton(entry));
    await tick(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai-test-insights/students/1001/sessions/11?centre=302");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionDate: "2026-11-13",
      areasOfConcern: `  Weak in ray optics ${MARKER} `,
      immediateActions: `Two worksheets ${MARKER}`,
      otherNotes: "",
      expectedRevision: 4,
    });
    expect(sessions.reload).toHaveBeenCalledTimes(1);
    expect(onEdited).toHaveBeenCalledTimes(1);
  });

  it("says another tab changed the notes on a 409 stale, keeps the typed text, and Reload notes reads again", async () => {
    edits = [{ status: 409, body: { error: "These notes were changed in another tab.", code: "stale", currentRevision: 5 } }];
    const sessions = loaded(TIMELINE);
    const entry = editAshasEntry(sessions);
    type(entry, "Areas of concern", `Typed in this tab ${MARKER}`);

    fireEvent.click(saveButton(entry));
    await tick(0);

    const alert = within(entry).getByRole("alert");
    expect(alert).toHaveTextContent("These notes were changed in another tab.");
    expect(field(entry, "Areas of concern").value).toBe(`Typed in this tab ${MARKER}`);
    expect(saveButton(entry)).toBeDisabled();
    expect(sessions.reload).not.toHaveBeenCalled();
    expect(onEdited).not.toHaveBeenCalled();

    fireEvent.click(within(alert).getByRole("button", { name: "Reload notes" }));
    expect(sessions.reload).toHaveBeenCalledTimes(1);
  });

  it("says a failed save failed, keeps the typed text, and lets the Teacher save again", async () => {
    edits = [{ status: 500, body: { error: "Session Notes could not be saved" } }];
    const sessions = loaded(TIMELINE);
    const entry = editAshasEntry(sessions);
    type(entry, "Areas of concern", `Typed in this tab ${MARKER}`);

    fireEvent.click(saveButton(entry));
    await tick(0);

    expect(within(entry).getByRole("alert")).toHaveTextContent("These changes could not be saved. Please try again.");
    expect(field(entry, "Areas of concern").value).toBe(`Typed in this tab ${MARKER}`);
    expect(saveButton(entry)).toBeEnabled();
    expect(sessions.reload).not.toHaveBeenCalled();

    fireEvent.click(saveButton(entry));
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sessions.reload).toHaveBeenCalledTimes(1);
  });
});
