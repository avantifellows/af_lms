import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AiTestInsightsSessionNotes from "./AiTestInsightsSessionNotes";
import type { InsightRequestView } from "@/lib/ai-test-insights-shared";

// The Session Notes section of the AI Test Insights Student page (#574): the
// Teacher's private draft, saved by itself about a second after typing stops,
// and its Submit (#575). fetch is stubbed: the history route answers from
// `reads`, in turn (the last repeats), each draft save from `saves`, in turn,
// or 200 with the next revision once `saves` runs out, and each submit from
// `submits`, in turn, or 201 once `submits` runs out.
const SESSIONS_URL = "/api/ai-test-insights/students/1005/sessions?centre=302";
const DRAFT_URL = "/api/ai-test-insights/students/1005/sessions/draft?centre=302";
const MARKER = "[marker-574-form]";

type Reply = { status: number; body: unknown };
type Deferred = { reply: Promise<Reply>; resolve: (reply: Reply) => void };

let reads: Reply[];
let saves: Array<Reply | Deferred>;
let submits: Array<Reply | Deferred>;
let readCount: number;
let fetchMock: ReturnType<typeof vi.fn>;

const writeAccess = (draft: unknown = null): Reply => ({
  status: 200,
  body: { timeline: [], draft, notesAccess: "write" },
});

function deferredSave(): Deferred {
  let resolve!: (reply: Reply) => void;
  const reply = new Promise<Reply>((res) => {
    resolve = res;
  });
  return { reply, resolve };
}

const asResponse = (reply: Reply) => ({
  ok: reply.status >= 200 && reply.status < 300,
  status: reply.status,
  json: () => Promise.resolve(reply.body),
});

/** The next queued reply (waiting for a deferred one), or `otherwise` once the queue is empty. */
async function answerFrom(queue: Array<Reply | Deferred>, otherwise: () => Reply) {
  const next = queue.shift();
  if (!next) return asResponse(otherwise());
  return asResponse("reply" in next ? await next.reply : next);
}

beforeEach(() => {
  // 19:00 UTC on 27 Nov is 00:30 on 28 Nov in India.
  vi.useFakeTimers({ now: new Date("2026-11-27T19:00:00Z"), toFake: ["setTimeout", "clearTimeout", "Date"] });
  reads = [writeAccess()];
  saves = [];
  submits = [];
  readCount = 0;
  let revision = 0;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const expectedRevision = () => (JSON.parse(String(init?.body)) as { expectedRevision: number }).expectedRevision;
    if (url === SESSIONS_URL && init?.method === "POST") {
      return answerFrom(submits, () => ({ status: 201, body: { sessionId: 90, revision: expectedRevision() + 1 } }));
    }
    if (url === SESSIONS_URL) return asResponse(reads[Math.min(readCount++, reads.length - 1)]);
    if (url === DRAFT_URL && init?.method === "PUT") {
      return answerFrom(saves, () => {
        revision = Math.max(revision, expectedRevision()) + 1;
        return { status: 200, body: { revision } };
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** The AI Summary card's request: completed, asked for at 01:00 on 28 Nov 2026 in India. */
const COMPLETED: InsightRequestView = {
  requestKey: "req-completed-1005",
  state: "completed",
  outcomeCode: null,
  selectedTestIds: ["T9"],
  requestedAt: "2026-11-27T19:30:00Z",
  requestedByName: "Asha Teacher",
  finishedAt: "2026-11-27T19:34:00Z",
};

let onSubmitted: ReturnType<typeof vi.fn>;

async function renderNotes(openRequest: InsightRequestView | null = null) {
  onSubmitted = vi.fn();
  render(
    <AiTestInsightsSessionNotes
      sessionsUrl={SESSIONS_URL}
      draftUrl={DRAFT_URL}
      openRequest={openRequest}
      onSubmitted={onSubmitted}
    />,
  );
  await tick(0);
}

const section = () => screen.getByRole("region", { name: "Session Notes" });
const field = (label: string) => within(section()).getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

const submitButton = () => within(section()).getByRole("button", { name: "Submit" });

/** Types the two required fields. */
function fillRequired() {
  type("Areas of concern", `Weak in optics ${MARKER}`);
  type("Immediate actions", `Two worksheets ${MARKER}`);
}

/** Each draft save and submit, in order: `PUT` or `POST` and its body. */
const writes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => ["PUT", "POST"].includes(String((init as RequestInit | undefined)?.method)))
    .map(([, init]) => [(init as RequestInit).method, JSON.parse(String((init as RequestInit).body))]);

/** The bodies of the draft saves, in order. */
const savedBodies = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === DRAFT_URL && (init as RequestInit | undefined)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe("AiTestInsightsSessionNotes", () => {
  it("reads the history route, never cached, and shows the Teacher's draft in the four fields", async () => {
    reads = [
      writeAccess({
        revision: 3,
        sessionDate: "2026-11-20",
        areasOfConcern: `Weak in optics ${MARKER}`,
        immediateActions: null,
        otherNotes: "Spoke with parents",
      }),
    ];

    await renderNotes();

    expect(fetchMock).toHaveBeenCalledWith(SESSIONS_URL, expect.objectContaining({ cache: "no-store" }));
    expect(field("Date of conversation").value).toBe("2026-11-20");
    expect(field("Areas of concern").value).toBe(`Weak in optics ${MARKER}`);
    expect(field("Immediate actions").value).toBe("");
    expect(field("Other notes (optional)").value).toBe("Spoke with parents");
  });

  it("opens a blank form dated today in India, and saves nothing", async () => {
    await renderNotes();

    expect(field("Date of conversation").value).toBe("2026-11-28");
    expect(field("Areas of concern").value).toBe("");
    await tick(5000);
    expect(savedBodies()).toEqual([]);
  });

  it("saves the draft once, about a second after typing stops, and shows Saving then Saved", async () => {
    const save = deferredSave();
    saves = [save];
    await renderNotes();

    type("Areas of concern", `Weak in optics ${MARKER}`);
    await tick(500);
    type("Immediate actions", "Two worksheets");
    await tick(999);
    expect(savedBodies()).toEqual([]);

    await tick(1);
    expect(within(section()).getByText("Saving…")).toBeInTheDocument();
    await act(async () => save.resolve({ status: 200, body: { revision: 1 } }));

    expect(within(section()).getByText("Saved")).toBeInTheDocument();
    expect(savedBodies()).toEqual([
      {
        sessionDate: "2026-11-28",
        areasOfConcern: `Weak in optics ${MARKER}`,
        immediateActions: "Two worksheets",
        otherNotes: "",
        expectedRevision: 0,
      },
    ]);
  });

  it("sends the revision each save answered with on the next save", async () => {
    reads = [writeAccess({ revision: 4, sessionDate: "2026-11-20", areasOfConcern: "a", immediateActions: null, otherNotes: null })];
    saves = [{ status: 200, body: { revision: 5 } }, { status: 200, body: { revision: 6 } }];
    await renderNotes();

    type("Areas of concern", "ab");
    await tick(1000);
    type("Areas of concern", "abc");
    await tick(1000);

    expect(savedBodies().map((body) => body.expectedRevision)).toEqual([4, 5]);
  });

  it("sends no date as null", async () => {
    await renderNotes();

    type("Date of conversation", "");
    type("Areas of concern", "a");
    await tick(1000);

    expect(savedBodies()[0]).toMatchObject({ sessionDate: null, areasOfConcern: "a" });
  });

  it("keeps one save in flight and sends the newest value next", async () => {
    const first = deferredSave();
    saves = [first];
    await renderNotes();

    type("Areas of concern", "one");
    await tick(1000);
    type("Areas of concern", "two");
    await tick(1000);
    type("Areas of concern", "three");
    await tick(1000);
    expect(savedBodies()).toHaveLength(1);

    await act(async () => first.resolve({ status: 200, body: { revision: 1 } }));
    await tick(0);

    expect(savedBodies().map((body) => [body.areasOfConcern, body.expectedRevision])).toEqual([
      ["one", 0],
      ["three", 1],
    ]);
    expect(within(section()).getByText("Saved")).toBeInTheDocument();
  });

  it("says when a save failed, and Retry sends the notes again", async () => {
    saves = [{ status: 500, body: { error: "Session Notes could not be saved" } }];
    await renderNotes();

    type("Areas of concern", "a");
    await tick(1000);

    const alert = within(section()).getByRole("alert");
    expect(alert).toHaveTextContent("These notes could not be saved.");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await tick(0);

    expect(savedBodies().map((body) => body.areasOfConcern)).toEqual(["a", "a"]);
    expect(within(section()).getByText("Saved")).toBeInTheDocument();
    expect(within(section()).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stops autosave when another tab saved first, keeps the typed text, and Reload notes reads them again", async () => {
    saves = [{ status: 409, body: { error: "These notes were changed in another tab.", code: "stale", currentRevision: 2 } }];
    reads = [
      writeAccess(),
      writeAccess({ revision: 2, sessionDate: "2026-11-27", areasOfConcern: "Newer text", immediateActions: null, otherNotes: null }),
    ];
    await renderNotes();

    type("Areas of concern", "Older text");
    await tick(1000);

    const alert = within(section()).getByRole("alert");
    expect(alert).toHaveTextContent("These notes were changed in another tab.");
    expect(field("Areas of concern").value).toBe("Older text");
    type("Areas of concern", "Older text, more");
    await tick(5000);
    expect(savedBodies()).toHaveLength(1);

    fireEvent.click(within(alert).getByRole("button", { name: "Reload notes" }));
    await tick(0);

    expect(field("Areas of concern").value).toBe("Newer text");
    expect(within(section()).queryByRole("alert")).not.toBeInTheDocument();
    type("Areas of concern", "Newer text, edited");
    await tick(1000);
    expect(savedBodies().at(-1)).toMatchObject({ areasOfConcern: "Newer text, edited", expectedRevision: 2 });
  });

  it("shows how many of the 2,000 characters each text field uses", async () => {
    await renderNotes();

    type("Immediate actions", "a".repeat(1234));

    expect(within(section()).getByText("1,234 / 2,000")).toBeInTheDocument();
    expect(within(section()).getAllByText("0 / 2,000")).toHaveLength(2);
  });

  it("marks a field over the limit, keeps all its text and sends nothing until it fits", async () => {
    await renderNotes();

    type("Areas of concern", "a".repeat(2001));
    await tick(5000);

    expect(field("Areas of concern").value).toHaveLength(2001);
    expect(field("Areas of concern")).toHaveAttribute("aria-invalid", "true");
    expect(within(section()).getByText("2,001 / 2,000")).toBeInTheDocument();
    expect(within(section()).getByText("Areas of concern is over the 2,000-character limit.")).toBeInTheDocument();
    expect(savedBodies()).toEqual([]);

    type("Areas of concern", "a".repeat(2000));
    await tick(1000);
    expect(field("Areas of concern")).not.toHaveAttribute("aria-invalid", "true");
    expect(savedBodies()).toHaveLength(1);
  });

  it("asks the browser to confirm leaving with an unsaved or failed draft, and not once saved", async () => {
    saves = [{ status: 500, body: {} }];
    await renderNotes();
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(leave()).toBe(false);
    type("Areas of concern", "a");
    expect(leave()).toBe(true);
    await tick(1000);
    expect(within(section()).getByRole("alert")).toBeInTheDocument();
    expect(leave()).toBe(true);

    fireEvent.click(within(section()).getByRole("button", { name: "Retry" }));
    await tick(0);
    expect(leave()).toBe(false);
  });

  it("replaces the form with the no-linked-user message", async () => {
    reads = [{ status: 200, body: { timeline: [], draft: null, notesAccess: "no_linked_user" } }];

    await renderNotes();

    expect(within(section()).getByText("Your login is not linked to a user record. Contact your program admin.")).toBeInTheDocument();
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows no section to someone with read access", async () => {
    reads = [{ status: 200, body: { timeline: [], draft: null, notesAccess: "read" } }];

    await renderNotes();

    expect(screen.queryByRole("region", { name: "Session Notes" })).not.toBeInTheDocument();
  });

  it("shows no form before the draft is known, and a failed read offers Retry", async () => {
    reads = [{ status: 500, body: { error: "Session Notes could not be loaded" } }, writeAccess()];
    render(<AiTestInsightsSessionNotes sessionsUrl={SESSIONS_URL} draftUrl={DRAFT_URL} openRequest={null} />);
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
    await tick(0);

    const alert = within(section()).getByRole("alert");
    expect(alert).toHaveTextContent("Session Notes could not be loaded.");
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await tick(0);

    expect(field("Areas of concern")).toBeInTheDocument();
  });
  describe("Submit", () => {
    it("is off until Areas of concern and Immediate actions both have text", async () => {
      await renderNotes();

      expect(submitButton()).toBeDisabled();
      type("Areas of concern", "Weak in optics");
      expect(submitButton()).toBeDisabled();
      type("Immediate actions", "  \n ");
      expect(submitButton()).toBeDisabled();
      type("Immediate actions", "Two worksheets");
      expect(submitButton()).toBeEnabled();
    });

    it("is off while the date is after today in India, and says why", async () => {
      await renderNotes();
      fillRequired();

      type("Date of conversation", "2026-11-29");

      expect(submitButton()).toBeDisabled();
      expect(within(section()).getByText("Date of conversation can't be after today.")).toBeInTheDocument();
      type("Date of conversation", "2026-11-28");
      expect(submitButton()).toBeEnabled();
    });

    it("is off while the date is empty", async () => {
      await renderNotes();
      fillRequired();

      type("Date of conversation", "");

      expect(submitButton()).toBeDisabled();
    });

    it("is off while a field is over the limit", async () => {
      await renderNotes();
      fillRequired();

      type("Other notes (optional)", "a".repeat(2001));

      expect(submitButton()).toBeDisabled();
    });

    it("is off while a save is running", async () => {
      const save = deferredSave();
      saves = [save];
      await renderNotes();
      fillRequired();

      await tick(1000);
      expect(within(section()).getByText("Saving…")).toBeInTheDocument();
      expect(submitButton()).toBeDisabled();

      await act(async () => save.resolve({ status: 200, body: { revision: 1 } }));
      expect(submitButton()).toBeEnabled();
    });

    it("saves the pending change first, then submits at the draft's revision with the open AI Summary", async () => {
      await renderNotes(COMPLETED);
      fillRequired();

      fireEvent.click(submitButton());
      await tick(0);

      const notes = {
        sessionDate: "2026-11-28",
        areasOfConcern: `Weak in optics ${MARKER}`,
        immediateActions: `Two worksheets ${MARKER}`,
        otherNotes: "",
      };
      expect(writes()).toEqual([
        ["PUT", { ...notes, expectedRevision: 0 }],
        ["POST", { ...notes, expectedRevision: 1, openRequestKey: "req-completed-1005" }],
      ]);
    });

    it("submits a loaded draft at its revision, with no save when nothing changed", async () => {
      reads = [
        writeAccess({
          revision: 4,
          sessionDate: "2026-11-20",
          areasOfConcern: "Weak in optics",
          immediateActions: "Two worksheets",
          otherNotes: null,
        }),
      ];
      await renderNotes();

      fireEvent.click(submitButton());
      await tick(0);

      expect(writes()).toEqual([
        [
          "POST",
          {
            sessionDate: "2026-11-20",
            areasOfConcern: "Weak in optics",
            immediateActions: "Two worksheets",
            otherNotes: "",
            expectedRevision: 4,
            openRequestKey: null,
          },
        ],
      ]);
    });

    it("says the notes will be linked to the AI Summary the card shows, dated in India", async () => {
      await renderNotes(COMPLETED);

      expect(within(section()).getByText("Linked to the AI Summary of 28 Nov 2026")).toBeInTheDocument();
    });

    it.each([
      ["no request", null],
      ["a failed request", { ...COMPLETED, state: "failed", outcomeCode: "generation_failed" }],
      ["a no_data request", { ...COMPLETED, state: "no_data", outcomeCode: "no_data" }],
      ["a queued request", { ...COMPLETED, state: "queued", finishedAt: null }],
      ["a running request", { ...COMPLETED, state: "running", finishedAt: null }],
    ] as Array<[string, InsightRequestView | null]>)(
      "links nothing while the card shows %s, and says so",
      async (_label, openRequest) => {
        await renderNotes(openRequest);
        fillRequired();

        expect(within(section()).getByText("No AI Summary is open, so these notes won't be linked to one.")).toBeInTheDocument();
        fireEvent.click(submitButton());
        await tick(0);
        expect(writes().at(-1)).toEqual(["POST", expect.objectContaining({ openRequestKey: null })]);
      },
    );

    it("says who can read submitted notes and what they are used for", async () => {
      await renderNotes();

      expect(
        within(section()).getByText(
          "Submitted notes are visible to staff with access to this School and are used for the next AI Summary.",
        ),
      ).toBeInTheDocument();
    });

    it("blanks the form after a submit, tells the page, and a new draft starts from revision 0", async () => {
      await renderNotes(COMPLETED);
      fillRequired();
      type("Date of conversation", "2026-11-25");

      fireEvent.click(submitButton());
      await tick(0);

      expect(onSubmitted).toHaveBeenCalledTimes(1);
      expect(field("Date of conversation").value).toBe("2026-11-28");
      expect(field("Areas of concern").value).toBe("");
      expect(field("Immediate actions").value).toBe("");
      expect(field("Other notes (optional)").value).toBe("");
      expect(submitButton()).toBeDisabled();
      await tick(5000);
      expect(writes()).toHaveLength(2);

      type("Areas of concern", "Next conversation");
      await tick(1000);
      expect(writes().at(-1)).toEqual(["PUT", expect.objectContaining({ areasOfConcern: "Next conversation", expectedRevision: 0 })]);
    });

    it("is off while the submit is running", async () => {
      const submit = deferredSave();
      submits = [submit];
      await renderNotes();
      fillRequired();

      fireEvent.click(submitButton());
      await tick(0);
      expect(submitButton()).toBeDisabled();

      await act(async () => submit.resolve({ status: 201, body: { sessionId: 90, revision: 2 } }));
      expect(onSubmitted).toHaveBeenCalledTimes(1);
    });

    it("shows the other-tab message with Reload notes when the submit is stale, and keeps the text", async () => {
      submits = [{ status: 409, body: { error: "These notes were changed in another tab.", code: "stale", currentRevision: 3 } }];
      await renderNotes();
      fillRequired();

      fireEvent.click(submitButton());
      await tick(0);

      const alert = within(section()).getByRole("alert");
      expect(alert).toHaveTextContent("These notes were changed in another tab.");
      expect(within(alert).getByRole("button", { name: "Reload notes" })).toBeInTheDocument();
      expect(field("Areas of concern").value).toBe(`Weak in optics ${MARKER}`);
      expect(submitButton()).toBeDisabled();
      expect(onSubmitted).not.toHaveBeenCalled();
      type("Areas of concern", "More");
      await tick(5000);
      expect(writes()).toHaveLength(2);
    });

    it("says when a submit failed, keeps the text, and Submit can be pressed again", async () => {
      submits = [{ status: 500, body: { error: "Session Notes could not be submitted" } }];
      await renderNotes();
      fillRequired();

      fireEvent.click(submitButton());
      await tick(0);

      expect(within(section()).getByRole("alert")).toHaveTextContent("These notes could not be submitted. Please try again.");
      expect(field("Areas of concern").value).toBe(`Weak in optics ${MARKER}`);
      expect(onSubmitted).not.toHaveBeenCalled();

      fireEvent.click(submitButton());
      await tick(0);
      expect(onSubmitted).toHaveBeenCalledTimes(1);
      expect(writes().map(([method, body]) => [method, body.expectedRevision])).toEqual([
        ["PUT", 0],
        ["POST", 1],
        ["POST", 1],
      ]);
    });

    it("submits nothing when the pending save fails, and shows the save's failure", async () => {
      saves = [{ status: 500, body: {} }];
      await renderNotes();
      fillRequired();

      fireEvent.click(submitButton());
      await tick(0);

      expect(within(section()).getByRole("alert")).toHaveTextContent("These notes could not be saved.");
      expect(writes().map(([method]) => method)).toEqual(["PUT"]);
    });
  });
});
