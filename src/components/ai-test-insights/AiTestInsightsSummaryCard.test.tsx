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

    // A completed request also keeps them, under its AI Summary (see "AI Summary" below).
    it.each(["no_data", "failed"] as const)(
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
              outcomeCode: "pipeline_error",
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
      expect(JSON.parse(String(init?.body))).toEqual({ selectedTestIds: ["T4", "T9"], generateAgain: true });
      expect(within(card()).queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        await within(card()).findByText("Waiting to start. This can take about 2 minutes if the server was asleep."),
      ).toBeInTheDocument();
      expect(within(card()).queryByText("The run was interrupted.")).not.toBeInTheDocument();
      expect(tryAgain()).not.toBeInTheDocument();
    });

    // Review finding 1 (#573): after "Generate again" failed or stalled, an
    // earlier completed AI Summary of the same tests exists. Try again must
    // still make a new request, never answer with that earlier one.
    it("Try again makes a new request even when a completed AI Summary of the same tests exists", async () => {
      const user = userEvent.setup();
      const earlier = ended({ requestKey: "key-earlier", state: "completed", outcomeCode: null });
      // Answers as the create route does: `existing` unless the body says generateAgain.
      const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((_url, init) => {
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(
          body.generateAgain === true
            ? {
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
              }
            : { ok: true, status: 200, json: () => Promise.resolve({ outcome: "existing", request: earlier }) },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      render(
        <AiTestInsightsSummaryCard
          tests={LOADED}
          canEdit
          onRetry={() => {}}
          requestsUrl={URL}
          initialRequest={ended({ outcomeCode: "timed_out" })}
        />,
      );

      await user.click(tryAgain()!);

      expect(
        await within(card()).findByText("Waiting to start. This can take about 2 minutes if the server was asleep."),
      ).toBeInTheDocument();
      expect(within(card()).queryByText("An AI Summary for these tests already exists")).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
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

// The card follows a request by itself (#563): it polls the status route every
// 10 seconds while the request is queued or running, and stops on a final
// state.
describe("AiTestInsightsSummaryCard polling", () => {
  const LOADED = { status: "loaded", tests: TESTS } as const;
  const WAITING = "Waiting to start. This can take about 2 minutes if the server was asleep.";
  const WRITING = "Writing the AI Summary. This usually takes about 4 minutes.";
  const STATUS_URL = "/api/ai-test-insights/students/1001/requests/key-1";

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

  /** Answers each status poll with the next of these; a number is a failed answer with that status, `null` a network error. */
  function answerPolls(...answers: Array<InsightRequestView | number | null>) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => {
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (next === null || next === undefined) return Promise.reject(new TypeError("fetch failed"));
      if (typeof next === "number") return Promise.resolve({ ok: false, status: next, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ request: next }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  /** The status polls among the calls; a completed request also reads its text from the summary route. */
  const statusPolls = (fetchMock: ReturnType<typeof answerPolls>) =>
    fetchMock.mock.calls.filter(([url]) => url === STATUS_URL);

  function renderWith(initialRequest: InsightRequestView, props: { canEdit?: boolean; requestsUrl?: string } = {}) {
    return render(
      <AiTestInsightsSummaryCard
        tests={LOADED}
        canEdit={props.canEdit ?? true}
        onRetry={() => {}}
        requestsUrl={props.requestsUrl ?? URL}
        initialRequest={initialRequest}
      />,
    );
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls the request's status every 10 seconds while it is queued", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = answerPolls(request());
    renderWith(request());

    await tick(9_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await tick(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(STATUS_URL);
    await tick(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("carries the page's centre to the status route", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = answerPolls(request());
    renderWith(request(), { requestsUrl: `${URL}?centre=302` });

    await tick(10_000);
    expect(fetchMock.mock.calls[0][0]).toBe(`${STATUS_URL}?centre=302`);
  });

  it("moves from waiting to writing with no reload", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    answerPolls(request({ state: "running" }));
    renderWith(request());

    expect(within(card()).getByText(WAITING)).toBeInTheDocument();
    await tick(10_000);
    expect(within(card()).getByText(WRITING)).toBeInTheDocument();
    expect(within(card()).queryByText(WAITING)).not.toBeInTheDocument();
  });

  it("keeps polling while the request is running", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = answerPolls(request({ state: "running" }));
    renderWith(request({ state: "running" }));

    await tick(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["no_data", "missing_category_for_cutoff", "This student has no category on record. Add it in Edit Student, then try again."],
    ["failed", "interrupted", "The run was interrupted."],
    ["failed", "timed_out", "The AI Summary took too long and was stopped."],
    ["completed", null, null],
  ] as const)("stops polling once the request is %s (%s)", async (state, outcomeCode, message) => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = answerPolls(request({ state, outcomeCode, finishedAt: "2026-11-27T05:34:00Z" }));
    renderWith(request({ state: "running" }));

    await tick(10_000);
    expect(statusPolls(fetchMock)).toHaveLength(1);
    expect(within(card()).queryByText(WRITING)).not.toBeInTheDocument();
    if (message) {
      expect(within(card()).getByText(message)).toBeInTheDocument();
      expect(within(card()).getByRole("button", { name: "Try again" })).toBeEnabled();
    }
    await tick(60_000);
    expect(statusPolls(fetchMock)).toHaveLength(1);
  });

  it.each(["completed", "no_data", "failed"] as const)("does not poll a request that is already %s", async (state) => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = answerPolls(request());
    renderWith(request({ state, outcomeCode: state === "completed" ? null : "interrupted", finishedAt: "2026-11-27T05:34:00Z" }));

    await tick(60_000);
    expect(statusPolls(fetchMock)).toHaveLength(0);
  });

  it.each([
    ["a 500", 500],
    ["a network error", null],
  ] as const)("keeps the last state after %s, and the next tick tries again", async (_label, failure) => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = answerPolls(failure, request({ state: "running" }));
    renderWith(request());

    await tick(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(card()).getByText(WAITING)).toBeInTheDocument();
    expect(within(card()).queryByRole("alert")).not.toBeInTheDocument();
    await tick(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(within(card()).getByText(WRITING)).toBeInTheDocument();
  });

  it("polls for a viewer too", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = answerPolls(request({ state: "running" }));
    renderWith(request(), { canEdit: false });

    await tick(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(within(card()).getByText(WRITING)).toBeInTheDocument();
  });

  it("starts polling the request Generate returned", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const created = request({ requestKey: "key-new" });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url) =>
      Promise.resolve(
        url === URL
          ? { ok: true, status: 201, json: () => Promise.resolve({ outcome: "created", request: created }) }
          : { ok: true, status: 200, json: () => Promise.resolve({ request: { ...created, state: "running" } }) },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AiTestInsightsSummaryCard tests={LOADED} canEdit onRetry={() => {}} requestsUrl={URL} />);

    await act(async () => within(card()).getByRole("button", { name: "Generate" }).click());
    expect(within(card()).getByText(WAITING)).toBeInTheDocument();
    await tick(10_000);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([URL, "/api/ai-test-insights/students/1001/requests/key-new"]);
    expect(within(card()).getByText(WRITING)).toBeInTheDocument();
  });
});

// A finished request (#564): the card reads the AI Summary text from the
// summary route and shows it, with the tests it was made from, who asked for
// it and when. The picker and Generate stay under it.
describe("AiTestInsightsSummaryCard AI Summary", () => {
  const SUMMARY_URL = "/api/ai-test-insights/students/1001/requests/key-1/summary";
  const MARKDOWN = "## Where Asha stands\n\n- Physics is improving\n\n| Subject | Score |\n| --- | --- |\n| Physics | 62 |\n";

  const completed = (overrides: Partial<InsightRequestView> = {}): InsightRequestView => ({
    requestKey: "key-1",
    state: "completed",
    outcomeCode: null,
    selectedTestIds: ["T9", "T4"],
    requestedAt: "2026-11-27T05:30:00Z",
    requestedByName: "Asha Teacher",
    finishedAt: "2026-11-27T05:34:10Z",
    ...overrides,
  });

  /** Answers each summary read with the next of these; a number is a failed answer with that status, `null` a network error. */
  function answerSummary(...answers: Array<string | number | null>) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => {
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (next === null || next === undefined) return Promise.reject(new TypeError("fetch failed"));
      if (typeof next === "number") return Promise.resolve({ ok: false, status: next, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ markdown: next }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function renderWith(
    initialRequest: InsightRequestView,
    props: { canEdit?: boolean; requestsUrl?: string; tests?: AiTestInsightsTest[] } = {},
  ) {
    return render(
      <AiTestInsightsSummaryCard
        tests={{ status: "loaded", tests: props.tests ?? TESTS }}
        canEdit={props.canEdit ?? true}
        onRetry={() => {}}
        requestsUrl={props.requestsUrl ?? URL}
        initialRequest={initialRequest}
      />,
    );
  }

  const summaryText = () => within(card()).findByRole("article", { name: "AI Summary text" });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads the text of a completed request from its summary route and shows it formatted", async () => {
    const fetchMock = answerSummary(MARKDOWN);
    renderWith(completed());

    const text = await summaryText();
    expect(within(text).getByRole("heading", { name: "Where Asha stands" })).toBeInTheDocument();
    expect(within(text).getByRole("listitem")).toHaveTextContent("Physics is improving");
    expect(within(text).getByRole("table")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SUMMARY_URL]);
  });

  it("carries the page's centre to the summary route", async () => {
    const fetchMock = answerSummary(MARKDOWN);
    renderWith(completed(), { requestsUrl: `${URL}?centre=302` });

    await summaryText();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${SUMMARY_URL}?centre=302`]);
  });

  it("names the tests it was made from, from the picker, newest first", async () => {
    answerSummary(MARKDOWN);
    renderWith(completed());

    await summaryText();
    expect(within(card()).getByText("Made from: Mock Test 1, Major Test 2")).toBeInTheDocument();
  });

  it('reads "an earlier test" for a test the picker does not list', async () => {
    answerSummary(MARKDOWN);
    renderWith(completed({ selectedTestIds: ["T9", "T1"] }));

    await summaryText();
    expect(within(card()).getByText("Made from: Mock Test 1, an earlier test")).toBeInTheDocument();
  });

  it("says who asked for it and when, in India time", async () => {
    answerSummary(MARKDOWN);
    renderWith(completed());

    await summaryText();
    expect(within(card()).getByText("Asked for by Asha Teacher on 27 Nov 2026, 11:00")).toBeInTheDocument();
  });

  it("keeps the picker and Generate under it, with the newest test ticked", async () => {
    answerSummary(MARKDOWN);
    renderWith(completed());

    await summaryText();
    expect(ticked()).toEqual(["T9"]);
    expect(box(/Major Test 2/)).toBeEnabled();
    expect(within(card()).getByRole("button", { name: "Generate" })).toBeEnabled();
  });

  it("shows a viewer the text, with no Generate", async () => {
    answerSummary(MARKDOWN);
    renderWith(completed(), { canEdit: false });

    expect(await summaryText()).toHaveTextContent("Where Asha stands");
    expect(within(card()).queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
  });

  it("makes no call but the summary read: no status poll, no wake, no enqueue", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:40:00Z") });
    const fetchMock = answerSummary(MARKDOWN);
    renderWith(completed());

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SUMMARY_URL]);
  });

  it.each([
    ["a 502", 502],
    ["a network error", null],
  ] as const)("says the text could not be loaded after %s, and Retry reads it again", async (_label, failure) => {
    const user = userEvent.setup();
    const fetchMock = answerSummary(failure, MARKDOWN);
    renderWith(completed());

    const alert = await within(card()).findByRole("alert");
    expect(alert).toHaveTextContent("The AI Summary could not be loaded");
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await summaryText()).toHaveTextContent("Where Asha stands");
    expect(within(card()).queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SUMMARY_URL, SUMMARY_URL]);
  });

  // The PDF the generator made (#565), from the PDF route, which 302s to
  // the file. Viewers download it too.
  const PDF_URL = "/api/ai-test-insights/students/1001/requests/key-1/pdf";
  const pdfLink = () => within(card()).getByRole("link", { name: "Download PDF" });

  it.each([
    ["a Teacher", true],
    ["a viewer", false],
  ] as const)("gives %s a Download PDF link to the request's PDF route", async (_label, canEdit) => {
    answerSummary(MARKDOWN);
    renderWith(completed(), { canEdit });

    await summaryText();
    expect(pdfLink()).toHaveAttribute("href", PDF_URL);
  });

  it("carries the page's centre to the PDF route", async () => {
    answerSummary(MARKDOWN);
    renderWith(completed(), { requestsUrl: `${URL}?centre=302` });

    await summaryText();
    expect(pdfLink()).toHaveAttribute("href", `${PDF_URL}?centre=302`);
  });

  it("keeps the Download PDF link when the text read fails", async () => {
    answerSummary(502);
    renderWith(completed());

    await within(card()).findByRole("alert");
    expect(pdfLink()).toHaveAttribute("href", PDF_URL);
  });

  it("offers the PDF link while the text is still loading, without fetching the PDF", () => {
    const fetchMock = vi.fn<(url: string) => Promise<unknown>>(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderWith(completed());

    expect(pdfLink()).toHaveAttribute("href", PDF_URL);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([SUMMARY_URL]);
  });

  it.each(["queued", "running", "no_data", "failed"] as const)("has no Download PDF link for a %s request", (state) => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderWith(
      completed({
        state,
        outcomeCode: state === "no_data" || state === "failed" ? "interrupted" : null,
        finishedAt: state === "queued" || state === "running" ? null : "2026-11-27T05:34:10Z",
      }),
    );

    expect(within(card()).queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
  });

  it("says it is loading the text", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderWith(completed());

    expect(within(card()).getByText("Loading the AI Summary…")).toBeInTheDocument();
  });

  it("shows the text of a request that completes while the card follows it", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T05:30:05Z") });
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url) =>
      Promise.resolve(
        url === SUMMARY_URL
          ? { ok: true, status: 200, json: () => Promise.resolve({ markdown: MARKDOWN }) }
          : { ok: true, status: 200, json: () => Promise.resolve({ request: completed() }) },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWith(completed({ state: "running", finishedAt: null }));

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(within(card()).getByRole("article", { name: "AI Summary text" })).toHaveTextContent("Where Asha stands");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/ai-test-insights/students/1001/requests/key-1",
      SUMMARY_URL,
    ]);
  });
});

describe("AiTestInsightsSummaryCard Generate again", () => {
  // The Student already has an AI Summary of Mock Test 1 and Major Test 2
  // (#567). The same tests again ask to confirm; other tests do not.
  const SUMMARY_URL = "/api/ai-test-insights/students/1001/requests/key-1/summary";
  const MARKDOWN = "## Where Asha stands\n\n- Physics is improving\n";
  const CONFIRM_TEXT =
    "This keeps the earlier AI Summary and writes a new one for these tests. It takes about 4 minutes.";
  const EXISTS_NOTE = "An AI Summary for these tests already exists";

  const completed = (overrides: Partial<InsightRequestView> = {}): InsightRequestView => ({
    requestKey: "key-1",
    state: "completed",
    outcomeCode: null,
    selectedTestIds: ["T9", "T4"],
    requestedAt: "2026-11-27T05:30:00Z",
    requestedByName: "Asha Teacher",
    finishedAt: "2026-11-27T05:34:10Z",
    ...overrides,
  });
  const queued = (overrides: Partial<InsightRequestView> = {}): InsightRequestView => ({
    requestKey: "key-2",
    state: "queued",
    outcomeCode: null,
    selectedTestIds: ["T9", "T4"],
    requestedAt: new Date().toISOString(),
    requestedByName: "Asha Teacher",
    finishedAt: null,
    ...overrides,
  });

  /** The summary route answers the text; the create route answers `post`. */
  function answer(post: { status: number; json: unknown }) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url, init) =>
      Promise.resolve(
        init?.method === "POST"
          ? { ok: post.status < 300, status: post.status, json: () => Promise.resolve(post.json) }
          : url.endsWith("/summary")
            ? { ok: true, status: 200, json: () => Promise.resolve({ markdown: MARKDOWN }) }
            : new Promise(() => {}),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  const posts = (fetchMock: ReturnType<typeof answer>) =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => [url, JSON.parse(String(init?.body))]);

  function renderWith(initialRequest: InsightRequestView | null, canEdit = true) {
    return render(
      <AiTestInsightsSummaryCard
        tests={{ status: "loaded", tests: TESTS }}
        canEdit={canEdit}
        onRetry={() => {}}
        requestsUrl={URL}
        initialRequest={initialRequest}
      />,
    );
  }

  const button = (name: string) => within(card()).queryByRole("button", { name });
  const dialog = () => screen.queryByRole("dialog", { name: "Generate again?" });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads Generate again while the ticked tests are the shown AI Summary's tests", async () => {
    const user = userEvent.setup();
    answer({ status: 201, json: {} });
    renderWith(completed());

    expect(button("Generate")).toBeInTheDocument();
    await user.click(box(/Major Test 2/));
    expect(button("Generate again")).toBeInTheDocument();
    expect(button("Generate")).not.toBeInTheDocument();

    await user.click(box(/Full Syllabus Test 1/));
    expect(button("Generate")).toBeInTheDocument();
    await user.click(box(/Full Syllabus Test 1/));
    expect(button("Generate again")).toBeInTheDocument();
  });

  it("reads Generate for the same tests when the shown request did not complete", async () => {
    const user = userEvent.setup();
    answer({ status: 201, json: {} });
    renderWith(completed({ state: "failed", outcomeCode: "interrupted" }));

    await user.click(box(/Major Test 2/));
    expect(button("Generate")).toBeInTheDocument();
    expect(button("Generate again")).not.toBeInTheDocument();
  });

  it("asks to confirm: it keeps the earlier AI Summary, writes a new one and takes about 4 minutes", async () => {
    const user = userEvent.setup();
    answer({ status: 201, json: {} });
    renderWith(completed());

    await user.click(box(/Major Test 2/));
    await user.click(button("Generate again")!);

    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()!).getByText(CONFIRM_TEXT)).toBeInTheDocument();
  });

  it("Cancel closes the confirmation and sends nothing", async () => {
    const user = userEvent.setup();
    const fetchMock = answer({ status: 201, json: {} });
    renderWith(completed());

    await user.click(box(/Major Test 2/));
    await user.click(button("Generate again")!);
    await user.click(within(dialog()!).getByRole("button", { name: "Cancel" }));

    expect(dialog()).not.toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([]);
    expect(within(card()).getByRole("article", { name: "AI Summary text" })).toBeInTheDocument();
  });

  it("Confirm sends the same tests with generateAgain and shows the new request", async () => {
    const user = userEvent.setup();
    const fetchMock = answer({ status: 201, json: { outcome: "created", request: queued() } });
    renderWith(completed());

    await user.click(box(/Major Test 2/));
    await user.click(button("Generate again")!);
    await user.click(within(dialog()!).getByRole("button", { name: "Generate again" }));

    expect(posts(fetchMock)).toEqual([[URL, { selectedTestIds: ["T9", "T4"], generateAgain: true }]]);
    expect(dialog()).not.toBeInTheDocument();
    expect(
      await within(card()).findByText("Waiting to start. This can take about 2 minutes if the server was asleep."),
    ).toBeInTheDocument();
  });

  it("sends other tests with no confirmation and no generateAgain", async () => {
    const user = userEvent.setup();
    const fetchMock = answer({ status: 201, json: { outcome: "created", request: queued({ selectedTestIds: ["T9"] }) } });
    renderWith(completed());

    await user.click(button("Generate")!);

    expect(dialog()).not.toBeInTheDocument();
    expect(posts(fetchMock)).toEqual([[URL, { selectedTestIds: ["T9"] }]]);
  });

  it("shows an existing answer's AI Summary with a note, and offers Generate again", async () => {
    const user = userEvent.setup();
    const fetchMock = answer({ status: 200, json: { outcome: "existing", request: completed() } });
    renderWith(null);

    await user.click(box(/Major Test 2/));
    await user.click(button("Generate")!);

    expect(await within(card()).findByText(EXISTS_NOTE)).toBeInTheDocument();
    expect(await within(card()).findByRole("article", { name: "AI Summary text" })).toHaveTextContent("Where Asha stands");
    expect(button("Generate again")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([URL, SUMMARY_URL]);
  });

  it("drops the note once the Teacher generates again", async () => {
    const user = userEvent.setup();
    const fetchMock = answer({ status: 200, json: { outcome: "existing", request: completed() } });
    renderWith(null);

    await user.click(box(/Major Test 2/));
    await user.click(button("Generate")!);
    await within(card()).findByText(EXISTS_NOTE);
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ outcome: "created", request: queued() }) }),
    );
    await user.click(button("Generate again")!);
    await user.click(within(dialog()!).getByRole("button", { name: "Generate again" }));

    await within(card()).findByText("Waiting to start. This can take about 2 minutes if the server was asleep.");
    expect(within(card()).queryByText(EXISTS_NOTE)).not.toBeInTheDocument();
  });

  it("shows a viewer no Generate again", async () => {
    answer({ status: 201, json: {} });
    renderWith(completed({ selectedTestIds: ["T9"] }), false);

    await within(card()).findByRole("article", { name: "AI Summary text" });
    expect(ticked()).toEqual(["T9"]);
    expect(button("Generate again")).not.toBeInTheDocument();
    expect(button("Generate")).not.toBeInTheDocument();
  });
});
