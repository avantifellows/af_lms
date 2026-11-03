import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEntryPayload,
  durationMinutes,
  initialEntryValues,
  photosPending,
  missingFields,
  postEntry,
  raisedFlags,
  sentActionItemIndex,
  toggled,
  unshownFieldError,
  withoutFieldErrors,
  type EntryFormValues,
  type ReviewDraft,
} from "./logEntryPayload";
import type { PickedPhoto } from "./PhotoPicker";

const TODAY = "2026-10-22";

const DRAFT: ReviewDraft = {
  id: 44,
  occurredOn: "2026-10-20",
  mode: "call",
  spokeWith: "both",
  durationMinutes: 35,
  summary: "Discussed the mock test.",
  actionItems: [
    { owner: "student", text: "Revise optics" },
    { owner: "mentor", text: "Share notes" },
  ],
  notesHtml: "<p>Notes</p>",
};

function values(change: Partial<EntryFormValues> = {}): EntryFormValues {
  return { ...initialEntryValues(null, TODAY), ...change };
}

function photo(id: number, status: PickedPhoto["status"], s3Key?: string): PickedPhoto {
  return { id, previewUrl: null, status, s3Key };
}

describe("initialEntryValues", () => {
  it("starts a call with the Student dated today, with a blank Student and a blank Mentor Action Item", () => {
    expect(initialEntryValues(null, TODAY)).toEqual({
      kind: "conversation",
      occurredOn: TODAY,
      mode: "call",
      spokeWith: "student",
      duration: "",
      summary: "",
      notesHtml: "",
      note: "",
      actionItems: [
        { key: 1, owner: "student", text: "" },
        { key: 2, owner: "mentor", text: "" },
      ],
      nextItemKey: 3,
      ticked: new Set(),
      flags: {},
      screenerUsed: null,
      screenerFeedbackDue: false,
      screenerRatings: { helpedUnderstand: null, moreComfortable: null },
    });
  });

  it("asks the screener question unticked only with a Screener link, and the ratings only while due", () => {
    const pick = (form: EntryFormValues) => [form.screenerUsed, form.screenerFeedbackDue];
    expect(pick(initialEntryValues(null, TODAY, { hasLink: true, feedbackDue: true }))).toEqual([false, true]);
    expect(pick(initialEntryValues(DRAFT, TODAY, { hasLink: true, feedbackDue: false }))).toEqual([false, false]);
    expect(pick(initialEntryValues(null, TODAY, { hasLink: false, feedbackDue: true }))).toEqual([null, false]);
  });

  it("prefills from a draft, keying its Action Items 1..n", () => {
    expect(initialEntryValues(DRAFT, TODAY)).toMatchObject({
      occurredOn: "2026-10-20",
      mode: "call",
      spokeWith: "both",
      duration: "35",
      summary: "Discussed the mock test.",
      notesHtml: "<p>Notes</p>",
      actionItems: [
        { key: 1, owner: "student", text: "Revise optics" },
        { key: 2, owner: "mentor", text: "Share notes" },
      ],
      nextItemKey: 3,
    });
  });

  it("falls back to today and blanks for a draft without session details, and starter rows without Action Items", () => {
    const draft = { ...DRAFT, occurredOn: null, mode: null, spokeWith: null, durationMinutes: null, actionItems: [] };
    expect(initialEntryValues(draft, TODAY)).toMatchObject({
      occurredOn: TODAY,
      mode: null,
      spokeWith: null,
      duration: "",
      actionItems: [
        { key: 1, owner: "student", text: "" },
        { key: 2, owner: "mentor", text: "" },
      ],
      nextItemKey: 3,
    });
  });
});

describe("small helpers", () => {
  it("reads a blank duration as none and anything else as a number", () => {
    expect(durationMinutes("  ")).toBeNull();
    expect(durationMinutes("45")).toBe(45);
  });

  it("toggles a value in a copy of the set", () => {
    const set = new Set([1]);
    expect(toggled(set, 2)).toEqual(new Set([1, 2]));
    expect(toggled(set, 1)).toEqual(new Set());
    expect(set).toEqual(new Set([1]));
  });

  it("drops the errors under a prefix", () => {
    expect(withoutFieldErrors({ summary: "a", "flags.0.comment": "b", flags: "c" }, "flags")).toEqual({ summary: "a" });
  });

  it("lists switched-on flags in display order", () => {
    expect(raisedFlags({ maths: "", emotional_wellbeing: "Upset" })).toEqual(["emotional_wellbeing", "maths"]);
  });

  it("counts each sent Action Item's position among the rows with text", () => {
    const items = [
      { key: 1, owner: "student" as const, text: " " },
      { key: 2, owner: "mentor" as const, text: "Call" },
      { key: 5, owner: "parent" as const, text: "Pay" },
    ];
    expect(sentActionItemIndex(items)).toEqual(new Map([[2, 0], [5, 1]]));
  });

  it("lists the required fields still empty, by label", () => {
    expect(missingFields(values())).toEqual(["Duration", "Summary"]);
    expect(missingFields(values({ mode: null, spokeWith: null, occurredOn: "" }))).toEqual([
      "Date",
      "How",
      "Spoke with",
      "Duration",
      "Summary",
    ]);
    expect(missingFields(values({ kind: "attempt" }))).toEqual([]);
  });

  it("needs both screener ratings while they show", () => {
    const filled = { duration: "20", summary: "Talked", screenerFeedbackDue: true };
    const ratings = (helpedUnderstand: number | null, moreComfortable: number | null) => ({
      screenerRatings: { helpedUnderstand, moreComfortable },
    });
    expect(missingFields(values({ ...filled, screenerUsed: true, ...ratings(3, null) }))).toEqual(["Screener ratings"]);
    expect(missingFields(values({ ...filled, screenerUsed: true, ...ratings(3, 1) }))).toEqual([]);
    expect(missingFields(values({ ...filled, screenerUsed: false }))).toEqual([]);
    expect(missingFields(values({ ...filled, screenerUsed: true, screenerFeedbackDue: false }))).toEqual([]);
  });

  it("finds the first error no field on the form shows, for the save bar", () => {
    const shown = { summary: "Add a summary.", "actionItems.0.text": "Add text.", "flags.1.comment": "Too long." };
    expect(unshownFieldError(shown, values({}))).toBeNull();
    expect(unshownFieldError({ ...shown, completeActionItemIds: "Bad ids." }, values({}))).toBe("Bad ids.");
    // The screener's errors show only while it is asked, the ratings' only while they show.
    const answer = { screenerUsed: "Say whether the screener form was used." };
    expect(unshownFieldError(answer, values({ screenerUsed: null }))).toBe(answer.screenerUsed);
    expect(unshownFieldError(answer, values({ screenerUsed: false }))).toBeNull();
    const rating = { "screenerFeedback.moreComfortable": "Choose a rating." };
    expect(unshownFieldError(rating, values({ screenerUsed: true, screenerFeedbackDue: true }))).toBeNull();
    expect(unshownFieldError(rating, values({ screenerUsed: true, screenerFeedbackDue: false }))).toBe("Choose a rating.");
    // An Attempt shows only the date (and the kind).
    expect(unshownFieldError({ occurredOn: "Enter the date." }, values({ kind: "attempt" }))).toBeNull();
    expect(unshownFieldError(shown, values({ kind: "attempt" }))).toBe("Add a summary.");
  });

  it("holds a Conversation back while a photo is uploading or failed, never an Attempt", () => {
    expect(photosPending("conversation", [photo(1, "done", "k")])).toBe(false);
    expect(photosPending("conversation", [photo(1, "done", "k"), photo(2, "uploading")])).toBe(true);
    expect(photosPending("conversation", [photo(1, "failed")])).toBe(true);
    expect(photosPending("attempt", [photo(1, "failed")])).toBe(false);
  });
});

describe("buildEntryPayload", () => {
  it("sends only the date and note for an Attempt", () => {
    expect(buildEntryPayload(values({ kind: "attempt", note: "No answer", summary: "x" }), [photo(1, "done", "k")], 44)).toEqual({
      kind: "attempt",
      occurredOn: TODAY,
      note: "No answer",
    });
  });

  it("sends a Conversation with its lists, no blank Action Items, and the reviewed draft", () => {
    const body = buildEntryPayload(
      values({
        mode: "in_person",
        spokeWith: "student",
        duration: "30",
        summary: "Talked",
        notesHtml: "<p>n</p>",
        actionItems: [
          { key: 1, owner: "student", text: "Revise" },
          { key: 3, owner: "mentor", text: "  " },
        ],
        ticked: new Set([7, 9]),
        flags: { physics: "Optics", emotional_wellbeing: "" },
      }),
      [photo(1, "done", "key-a"), photo(2, "done", "key-b")],
      44
    );
    expect(body).toEqual({
      kind: "conversation",
      occurredOn: TODAY,
      mode: "in_person",
      spokeWith: "student",
      durationMinutes: 30,
      summary: "Talked",
      notesHtml: "<p>n</p>",
      actionItems: [{ owner: "student", text: "Revise" }],
      photoKeys: ["key-a", "key-b"],
      flags: [
        { recipient: "emotional_wellbeing", comment: null },
        { recipient: "physics", comment: "Optics" },
      ],
      completeActionItemIds: [7, 9],
      draftId: 44,
    });
  });

  it("sends the screener answer only when asked, and the ratings only while they show", () => {
    const ratings = { helpedUnderstand: 2, moreComfortable: 5 };
    const asked = { screenerFeedbackDue: true, screenerRatings: ratings };
    const screener = (overrides: Partial<EntryFormValues>) => {
      const body = buildEntryPayload(values(overrides), [], null);
      return { screenerUsed: body.screenerUsed, screenerFeedback: body.screenerFeedback };
    };

    expect(screener({ screenerUsed: null })).toEqual({});
    expect(screener({ ...asked, screenerUsed: false })).toEqual({ screenerUsed: false });
    expect(screener({ ...asked, screenerUsed: true })).toEqual({ screenerUsed: true, screenerFeedback: ratings });
    expect(screener({ ...asked, screenerUsed: true, screenerFeedbackDue: false })).toEqual({ screenerUsed: true });
    expect(buildEntryPayload(values({ ...asked, kind: "attempt", screenerUsed: true }), [], null)).not.toHaveProperty(
      "screenerUsed"
    );
  });

  it("leaves draftId out without a draft and sends a blank duration as null", () => {
    const body = buildEntryPayload(values(), [], null);
    expect(body).not.toHaveProperty("draftId");
    expect(body.durationMinutes).toBeNull();
  });
});

describe("postEntry", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(body: string, status: number) {
    mockFetch.mockResolvedValueOnce(new Response(body, { status }));
  }

  it("posts the body as JSON to the Mentee's entries route", async () => {
    answer(JSON.stringify({ entry: { id: 1 }, mentee: { studentId: 501 } }), 201);
    await expect(postEntry(501, { kind: "attempt" })).resolves.toEqual({ ok: true, mentee: { studentId: 501 } });
    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/students/501/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "attempt" }),
    });
  });

  it("reads a missing mentee as null", async () => {
    answer(JSON.stringify({ entry: { id: 1 } }), 201);
    await expect(postEntry(501, {})).resolves.toEqual({ ok: true, mentee: null });
  });

  it("returns field errors without a message", async () => {
    answer(JSON.stringify({ error: "Add a summary.", fieldErrors: { summary: "Add a summary." } }), 422);
    await expect(postEntry(501, {})).resolves.toEqual({
      ok: false,
      fieldErrors: { summary: "Add a summary." },
      error: null,
    });
  });

  it("returns the server's message, or a fallback for an unreadable answer, and clears field errors", async () => {
    answer(JSON.stringify({ error: "Not found" }), 404);
    await expect(postEntry(501, {})).resolves.toEqual({ ok: false, fieldErrors: {}, error: "Not found" });
    answer("<html>", 500);
    await expect(postEntry(501, {})).resolves.toEqual({
      ok: false,
      fieldErrors: {},
      error: "Couldn't save. Try again.",
    });
  });

  it("keeps the form's field errors when the request never arrives", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("offline"));
    await expect(postEntry(501, {})).resolves.toEqual({
      ok: false,
      fieldErrors: null,
      error: "Couldn't save. Check your connection and try again.",
    });
  });
});
