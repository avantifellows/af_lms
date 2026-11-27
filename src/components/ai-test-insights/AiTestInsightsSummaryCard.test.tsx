import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AiTestInsightsSummaryCard from "./AiTestInsightsSummaryCard";
import type { AiTestInsightsTest, InsightRequestView } from "@/lib/ai-test-insights-shared";

// The AI Summary card's test picker (#559), from a picker read written by
// hand: three tests, newest first.
const TESTS: AiTestInsightsTest[] = [
  { id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" },
  { id: "T7", name: "Full Syllabus Test 1", date: "2026-10-20", format: "full_syllabus_test" },
  { id: "T4", name: "Major Test 2", date: "2026-10-12", format: "major_test" },
];

const URL = "/api/ai-test-insights/students/1001/requests";

const card = () => screen.getByRole("region", { name: "AI Summary" });
const box = (name: RegExp) => within(card()).getByRole("checkbox", { name });
const ticked = () =>
  within(card())
    .getAllByRole("checkbox")
    .filter((checkbox) => (checkbox as HTMLInputElement).checked)
    .map((checkbox) => checkbox.getAttribute("value"));

describe("AiTestInsightsSummaryCard", () => {
  it("lists the tests newest first, each with its date and kind, with the newest ticked", () => {
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit onRetry={() => {}} requestsUrl={URL} />);

    const rows = within(card()).getAllByRole("listitem").map((item) => item.textContent);
    expect(rows).toEqual([
      "Mock Test 12 Nov 2026 · Mock test",
      "Full Syllabus Test 120 Oct 2026 · Full Syllabus test",
      "Major Test 212 Oct 2026 · Major test",
    ]);
    expect(ticked()).toEqual(["T9"]);
  });

  it("lets a Teacher tick more tests and untick them again", async () => {
    const user = userEvent.setup();
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit onRetry={() => {}} requestsUrl={URL} />);

    await user.click(box(/Major Test 2/));
    await user.click(box(/Full Syllabus Test 1/));
    expect(ticked()).toEqual(["T9", "T7", "T4"]);

    await user.click(box(/Mock Test 1/));
    expect(ticked()).toEqual(["T7", "T4"]);
  });

  it("keeps the last ticked test ticked", async () => {
    const user = userEvent.setup();
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit onRetry={() => {}} requestsUrl={URL} />);

    expect(box(/Mock Test 1/)).toBeDisabled();
    await user.click(box(/Mock Test 1/));
    expect(ticked()).toEqual(["T9"]);
    expect(within(card()).getByText("At least one test stays ticked.")).toBeInTheDocument();

    await user.click(box(/Major Test 2/));
    expect(box(/Mock Test 1/)).toBeEnabled();
    await user.click(box(/Mock Test 1/));
    expect(ticked()).toEqual(["T4"]);
    expect(box(/Major Test 2/)).toBeDisabled();
  });

  it("shows a viewer the picker read-only, with the newest test ticked", async () => {
    const user = userEvent.setup();
    render(
      <AiTestInsightsSummaryCard tests={{ status: "loaded", tests: TESTS }} canEdit={false} onRetry={() => {}} requestsUrl={URL} />,
    );

    const checkboxes = within(card()).getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    for (const checkbox of checkboxes) expect(checkbox).toBeDisabled();
    await user.click(box(/Major Test 2/));
    expect(ticked()).toEqual(["T9"]);
    expect(within(card()).queryByText("At least one test stays ticked.")).not.toBeInTheDocument();
  });

  it("says when the Student has no submitted Major, Full Syllabus or Mock test this year", () => {
    render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: [] }} canEdit onRetry={() => {}} requestsUrl={URL} />);

    expect(
      within(card()).getByText("This student has no submitted Major, Full Syllabus or Mock test this year."),
    ).toBeInTheDocument();
    expect(within(card()).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says the tests could not be loaded, and Retry asks again", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<AiTestInsightsSummaryCard tests={{ status: "failed" }} canEdit onRetry={onRetry} requestsUrl={URL} />);

    expect(within(card()).getByRole("alert")).toHaveTextContent("Tests could not be loaded");
    await user.click(within(card()).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says it is loading the tests", () => {
    render(<AiTestInsightsSummaryCard tests={{ status: "loading" }} canEdit onRetry={() => {}} requestsUrl={URL} />);

    expect(within(card()).getByText("Loading tests…")).toBeInTheDocument();
  });

  describe("Generate", () => {
    const LOADED = { status: "loaded", tests: TESTS } as const;
    const WAITING = "Waiting to start. This can take about 2 minutes if the server was asleep.";
    const WRITING = "Writing the AI Summary. This usually takes about 4 minutes.";
    const LEAVE = "You can leave this page and come back.";

    const request = (overrides: Partial<InsightRequestView> = {}): InsightRequestView => ({
      requestKey: "key-1",
      state: "queued",
      outcomeCode: null,
      selectedTestIds: ["T9", "T4"],
      requestedAt: "2026-11-27T05:30:00Z",
      requestedByName: "Asha Teacher",
      finishedAt: null,
      ...overrides,
    });

    function answerPost(status: number, json: unknown) {
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() =>
        Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(json) }),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    const generate = () => within(card()).queryByRole("button", { name: "Generate" });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("posts the ticked ids in the picker's order, newest first", async () => {
      const user = userEvent.setup();
      const fetchMock = answerPost(201, { outcome: "created", request: request({ selectedTestIds: ["T9", "T7", "T4"] }) });
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

      await user.click(box(/Major Test 2/));
      await user.click(box(/Full Syllabus Test 1/));
      await user.click(generate()!);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(URL);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ selectedTestIds: ["T9", "T7", "T4"] });
    });

    it("shows the new request waiting, locks the picker and hides Generate", async () => {
      const user = userEvent.setup();
      answerPost(201, { outcome: "created", request: request({ requestedAt: new Date().toISOString() }) });
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

      await user.click(box(/Major Test 2/));
      await user.click(generate()!);

      expect(await within(card()).findByText(WAITING)).toBeInTheDocument();
      expect(within(card()).getByText(LEAVE)).toBeInTheDocument();
      expect(generate()).not.toBeInTheDocument();
      for (const checkbox of within(card()).getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
      expect(ticked()).toEqual(["T9", "T4"]);
    });

    it("shows the request already running for the Student, with its own tests", async () => {
      const user = userEvent.setup();
      answerPost(200, { outcome: "already_running", request: request({ state: "running", selectedTestIds: ["T7"] }) });
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

      await user.click(generate()!);

      expect(await within(card()).findByText(WRITING)).toBeInTheDocument();
      expect(ticked()).toEqual(["T7"]);
      expect(generate()).not.toBeInTheDocument();
    });

    it("counts the time since a queued request was made", () => {
      vi.useFakeTimers({ now: new Date("2026-11-27T05:31:05Z") });
      render(
        <AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} initialRequest={request()} />,
      );

      expect(within(card()).getByText(WAITING)).toBeInTheDocument();
      expect(within(card()).getByText(LEAVE)).toBeInTheDocument();
      expect(within(card()).getByText("1 min 5 s elapsed")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(60_000));
      expect(within(card()).getByText("2 min 5 s elapsed")).toBeInTheDocument();
    });

    it("counts the time since a running request was made", () => {
      vi.useFakeTimers({ now: new Date("2026-11-27T05:30:42Z") });
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit
          onRetry={() => {}}
          requestsUrl={URL}
          initialRequest={request({ state: "running" })}
        />,
      );

      expect(within(card()).getByText(WRITING)).toBeInTheDocument();
      expect(within(card()).getByText(LEAVE)).toBeInTheDocument();
      expect(within(card()).getByText("42 s elapsed")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(3_000));
      expect(within(card()).getByText("45 s elapsed")).toBeInTheDocument();
      for (const checkbox of within(card()).getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
      expect(generate()).not.toBeInTheDocument();
    });

    it.each(["completed", "no_data", "failed"] as const)(
      "shows the picker and Generate after a %s request, as if there were none",
      (state) => {
        render(
          <AiTestInsightsSummaryCard
            tests={LOADED}
            canEdit
            onRetry={() => {}}
            requestsUrl={URL}
            initialRequest={request({
              state,
              outcomeCode: state === "completed" ? null : "pipeline_error",
              finishedAt: "2026-11-27T05:34:00Z",
            })}
          />,
        );

        expect(generate()).toBeEnabled();
        expect(ticked()).toEqual(["T9"]);
        expect(box(/Major Test 2/)).toBeEnabled();
        expect(within(card()).queryByText(LEAVE)).not.toBeInTheDocument();
      },
    );

    it("shows a viewer the request's state, the picker locked and no Generate", () => {
      vi.useFakeTimers({ now: new Date("2026-11-27T05:30:10Z") });
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit={false}
          onRetry={() => {}}
          requestsUrl={URL}
          initialRequest={request()}
        />,
      );

      expect(within(card()).getByText(WAITING)).toBeInTheDocument();
      expect(within(card()).getByText("10 s elapsed")).toBeInTheDocument();
      expect(generate()).not.toBeInTheDocument();
      expect(ticked()).toEqual(["T9", "T4"]);
    });

    it("shows a viewer no Generate when there is no request", () => {
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit={false} onRetry={() => {}} requestsUrl={URL} />);

      expect(generate()).not.toBeInTheDocument();
    });

    it("turns Generate off when the Student has no tests", () => {
      render(<AiTestInsightsSummaryCard tests={{ status: "loaded", tests: [] }} canEdit onRetry={() => {}} requestsUrl={URL} />);

      expect(generate()).toBeDisabled();
    });

    it("turns Generate off when the tests could not be loaded, or are still loading", () => {
      const { rerender } = render(
        <AiTestInsightsSummaryCard tests={{ status: "failed" }} canEdit onRetry={() => {}} requestsUrl={URL} />,
      );
      expect(generate()).toBeDisabled();

      rerender(<AiTestInsightsSummaryCard tests={{ status: "loading" }} canEdit onRetry={() => {}} requestsUrl={URL} />);
      expect(generate()).toBeDisabled();
    });

    it("tells a Teacher whose login has no User to contact their program admin", async () => {
      const user = userEvent.setup();
      answerPost(409, { error: "Your login is not linked to a user record.", code: "no_linked_user" });
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

      await user.click(generate()!);

      expect(await within(card()).findByRole("alert")).toHaveTextContent(
        "Your login is not linked to a user record. Contact your program admin.",
      );
      expect(generate()).toBeEnabled();
    });

    it("says in plain words that generation is not set up in this environment", async () => {
      const user = userEvent.setup();
      answerPost(503, { error: "AI Summary generation is not set up in this environment.", code: "not_configured" });
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

      await user.click(generate()!);

      expect(await within(card()).findByRole("alert")).toHaveTextContent(
        "AI Summary generation is not set up in this environment.",
      );
      expect(within(card()).queryByText(/Waiting to start/)).not.toBeInTheDocument();
    });

    it("shows a request the generator refused as failed, with the general message and Try again", async () => {
      const user = userEvent.setup();
      answerPost(201, {
        outcome: "created",
        request: {
          requestKey: "key-rejected",
          state: "failed",
          outcomeCode: "enqueue_rejected",
          selectedTestIds: ["T9"],
          requestedAt: "2026-11-27T05:30:00Z",
          requestedByName: "Asha Teacher",
          finishedAt: "2026-11-27T05:30:02Z",
        },
      });
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

      await user.click(generate()!);

      expect(await within(card()).findByText("Something went wrong while writing the AI Summary.")).toBeInTheDocument();
      expect(within(card()).getByRole("button", { name: "Try again" })).toBeEnabled();
    });

    it("says the request failed when the server cannot record it, and Generate stays", async () => {
      const user = userEvent.setup();
      answerPost(500, { error: "The AI Summary could not be requested" });
      render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

      await user.click(generate()!);

      expect(await within(card()).findByRole("alert")).toHaveTextContent("The AI Summary could not be requested. Try again.");
      expect(generate()).toBeEnabled();
    });
  });

  // A request that ended without an AI Summary (#561): the reason in plain
  // words and "Try again", which sends the same tests again.
  describe("No AI Summary", () => {
    const LOADED = { status: "loaded", tests: TESTS } as const;
    const NO_SUMMARY = "No AI Summary could be made";
    const NO_CATEGORY = "This student has no category on record. Add it in Edit Student, then try again.";

    const ended = (overrides: Partial<InsightRequestView>): InsightRequestView => ({
      requestKey: "key-old",
      state: "failed",
      outcomeCode: "interrupted",
      selectedTestIds: ["T7", "T4"],
      requestedAt: "2026-11-27T05:30:00Z",
      requestedByName: "Asha Teacher",
      finishedAt: "2026-11-27T05:34:00Z",
      ...overrides,
    });

    const tryAgain = () => within(card()).queryByRole("button", { name: "Try again" });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("says no AI Summary could be made, why, and offers Try again for a no-data request", () => {
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit
          onRetry={() => {}}
          requestsUrl={URL}
          initialRequest={ended({ state: "no_data", outcomeCode: "missing_category_for_cutoff" })}
        />,
      );

      expect(within(card()).getByText(NO_SUMMARY)).toBeInTheDocument();
      expect(within(card()).getByText(NO_CATEGORY)).toBeInTheDocument();
      expect(tryAgain()).toBeEnabled();
    });

    it.each([
      ["interrupted", "The run was interrupted."],
      ["pipeline_error", "Something went wrong while writing the AI Summary."],
    ])("shows the reason for a failed request (%s) and offers Try again", (outcomeCode, message) => {
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit
          onRetry={() => {}}
          requestsUrl={URL}
          initialRequest={ended({ state: "failed", outcomeCode })}
        />,
      );

      expect(within(card()).getByText(message)).toBeInTheDocument();
      expect(within(card()).queryByText(NO_SUMMARY)).not.toBeInTheDocument();
      expect(tryAgain()).toBeEnabled();
    });

    it("Try again posts the failed request's tests in their order, with no confirmation, and shows the new request", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              outcome: "created",
              request: ended({
                requestKey: "key-new",
                state: "queued",
                outcomeCode: null,
                requestedAt: new Date().toISOString(),
                finishedAt: null,
              }),
            }),
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit
          onRetry={() => {}}
          requestsUrl={URL}
          // Not the picker's order: the request's own order is sent.
          initialRequest={ended({ selectedTestIds: ["T4", "T9"] })}
        />,
      );

      await user.click(tryAgain()!);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(URL);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ selectedTestIds: ["T4", "T9"] });
      expect(within(card()).queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        await within(card()).findByText("Waiting to start. This can take about 2 minutes if the server was asleep."),
      ).toBeInTheDocument();
      expect(within(card()).queryByText("The run was interrupted.")).not.toBeInTheDocument();
      expect(tryAgain()).not.toBeInTheDocument();
    });

    it("keeps the reason and Try again when Try again cannot be recorded", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "x" }) })),
      );
      render(
        <AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} initialRequest={ended({})} />,
      );

      await user.click(tryAgain()!);

      expect(await within(card()).findByRole("alert")).toHaveTextContent("The AI Summary could not be requested. Try again.");
      expect(within(card()).getByText("The run was interrupted.")).toBeInTheDocument();
      expect(tryAgain()).toBeEnabled();
    });

    it("keeps the picker usable, so the Teacher can choose other tests and Generate", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() =>
        Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({ outcome: "created", request: ended({ requestKey: "key-new", state: "queued" }) }),
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit
          onRetry={() => {}}
          requestsUrl={URL}
          initialRequest={ended({ state: "no_data", outcomeCode: "no_candidate_tests" })}
        />,
      );

      await user.click(box(/Full Syllabus Test 1/));
      await user.click(box(/Mock Test 1/));
      await user.click(within(card()).getByRole("button", { name: "Generate" }));

      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ selectedTestIds: ["T7"] });
    });

    it.each(["no_data", "failed"] as const)("shows a viewer the reason for a %s request and no Try again", (state) => {
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit={false}
          onRetry={() => {}}
          requestsUrl={URL}
          initialRequest={ended({ state, outcomeCode: "missing_category_for_cutoff" })}
        />,
      );

      expect(within(card()).getByText(NO_CATEGORY)).toBeInTheDocument();
      expect(tryAgain()).not.toBeInTheDocument();
      expect(within(card()).queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
    });
  });
});
