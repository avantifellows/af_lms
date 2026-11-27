import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

function renderHistory(sessions: SessionsRead, tests: AiTestInsightsTestsState = TESTS) {
  render(<AiTestInsightsHistory sessions={sessions} tests={tests} />);
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
