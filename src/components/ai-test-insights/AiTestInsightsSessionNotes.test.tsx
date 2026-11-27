import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AiTestInsightsSessionNotes from "./AiTestInsightsSessionNotes";

// The Session Notes section of the AI Test Insights Student page (#574): the
// Teacher's private draft, saved by itself about a second after typing stops.
// fetch is stubbed: the history route answers from `reads`, in turn (the last
// repeats), and each draft save from `saves`, in turn, or 200 with the next
// revision once `saves` runs out.
const SESSIONS_URL = "/api/ai-test-insights/students/1005/sessions?centre=302";
const DRAFT_URL = "/api/ai-test-insights/students/1005/sessions/draft?centre=302";
const MARKER = "[marker-574-form]";

type Reply = { status: number; body: unknown };
type Deferred = { reply: Promise<Reply>; resolve: (reply: Reply) => void };

let reads: Reply[];
let saves: Array<Reply | Deferred>;
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

beforeEach(() => {
  // 19:00 UTC on 27 Nov is 00:30 on 28 Nov in India.
  vi.useFakeTimers({ now: new Date("2026-11-27T19:00:00Z"), toFake: ["setTimeout", "clearTimeout", "Date"] });
  reads = [writeAccess()];
  saves = [];
  readCount = 0;
  let revision = 0;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === SESSIONS_URL) return asResponse(reads[Math.min(readCount++, reads.length - 1)]);
    if (url === DRAFT_URL && init?.method === "PUT") {
      const next = saves.shift();
      if (next && "reply" in next) return asResponse(await next.reply);
      if (next) return asResponse(next);
      const { expectedRevision } = JSON.parse(String(init.body)) as { expectedRevision: number };
      revision = Math.max(revision, expectedRevision) + 1;
      return asResponse({ status: 200, body: { revision } });
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

async function renderNotes() {
  render(<AiTestInsightsSessionNotes sessionsUrl={SESSIONS_URL} draftUrl={DRAFT_URL} />);
  await tick(0);
}

const section = () => screen.getByRole("region", { name: "Session Notes" });
const field = (label: string) => within(section()).getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

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
    render(<AiTestInsightsSessionNotes sessionsUrl={SESSIONS_URL} draftUrl={DRAFT_URL} />);
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
    await tick(0);

    const alert = within(section()).getByRole("alert");
    expect(alert).toHaveTextContent("Session Notes could not be loaded.");
    expect(within(section()).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await tick(0);

    expect(field("Areas of concern")).toBeInTheDocument();
  });
});
