import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiTestInsightsStudentSections from "./AiTestInsightsStudentSections";
import type { AiTestInsightsStudentCardData } from "@/lib/ai-test-insights-shared";

// The Student page's cards around one read of the test picker route (#559):
// the Student card's newest test line and the AI Summary card's picker come
// from the same response. fetch is stubbed with hand-written replies.
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

/**
 * Stubs fetch, answering each read of the test picker route with the next
 * reply (the last repeats), and the Session Notes read with `NO_DRAFT`.
 * Returns the picker route's calls.
 */
function stubFetch(...replies: Reply[]) {
  let call = 0;
  const pickerCalls = vi.fn();
  const fetchMock = vi.fn((url: string) => {
    let reply = NO_DRAFT;
    if (url.endsWith("/tests")) {
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

function renderSections(canEdit = true, centreId: number | null = null) {
  render(
    <AiTestInsightsStudentSections student={CARD} studentId={1005} canEdit={canEdit} centreId={centreId}>
      <section aria-label="Performance" />
    </AiTestInsightsStudentSections>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("puts the Student card first, the other cards next, then the AI Summary card and Session Notes below it", async () => {
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections();

    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions).toEqual(["Student", "Performance", "AI Summary", "Session Notes"]);
    await within(summary()).findAllByRole("checkbox");
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

  it("shows a viewer no Session Notes section and reads no notes", async () => {
    stubFetch({ status: 200, body: { tests: TESTS } });
    renderSections(false);

    await within(summary()).findAllByRole("checkbox");
    expect(screen.queryByRole("region", { name: "Session Notes" })).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual(["/api/ai-test-insights/students/1005/tests"]);
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
});
