import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateEntry } from "./blended-learning-log-entry-input";

const TODAY = "2026-10-22";
const STUDENT = 501;
const PHOTO_PREFIX = `test-prefix/blended-learning/photos/${STUDENT}/`;
const PHOTO_A = `${PHOTO_PREFIX}0f8fad5b-d9cb-469f-a165-70867728950e.jpg`;
const PHOTO_B = `${PHOTO_PREFIX}7c9e6679-7425-40de-944b-e07fc1f90ae7.png`;

const CONVERSATION = {
  kind: "conversation",
  occurredOn: "2026-10-21",
  mode: "call",
  spokeWith: "student",
  durationMinutes: 30,
  summary: "  Talked about the mock test.  ",
};

beforeEach(() => {
  vi.stubEnv("S3_DOCS_PREFIX", "test-prefix");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateEntry: kind", () => {
  it.each([undefined, null, "note", { kind: "call" }])("asks for a Conversation or an Attempt for %j", (raw) => {
    expect(validateEntry(raw, TODAY, STUDENT)).toEqual({
      ok: false,
      fieldErrors: { kind: "Choose a Conversation or an Attempt." },
    });
  });
});

describe("validateEntry: Attempt", () => {
  it("accepts a dated Attempt with a trimmed note", () => {
    expect(validateEntry({ kind: "attempt", occurredOn: TODAY, note: "  No answer  " }, TODAY, STUDENT)).toEqual({
      ok: true,
      input: { kind: "attempt", occurredOn: TODAY, note: "No answer" },
    });
  });

  it("keeps a blank note as null", () => {
    expect(validateEntry({ kind: "attempt", occurredOn: TODAY, note: "  " }, TODAY, STUDENT)).toEqual({
      ok: true,
      input: { kind: "attempt", occurredOn: TODAY, note: null },
    });
  });

  it("refuses what only a Conversation carries, in field order", () => {
    const result = validateEntry(
      {
        kind: "attempt",
        occurredOn: "2026-10-23",
        actionItems: [],
        photoKeys: [],
        flags: [],
        completeActionItemIds: [],
        draftId: 4,
      },
      TODAY,
      STUDENT
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        occurredOn: "The date can't be in the future.",
        actionItems: "An Attempt can't have Action Items.",
        photoKeys: "An Attempt can't have photos.",
        flags: "An Attempt can't have Mentor Flags.",
        completeActionItemIds: "Only a Conversation can tick Action Items done.",
        draftId: "A Conversation Draft can only be saved as a Conversation.",
      },
    });
    expect(result.ok === false && Object.keys(result.fieldErrors)[0]).toBe("occurredOn");
  });

  it("allows a null draftId on an Attempt", () => {
    expect(validateEntry({ kind: "attempt", occurredOn: TODAY, draftId: null }, TODAY, STUDENT).ok).toBe(true);
  });
});

describe("validateEntry: Conversation", () => {
  it("accepts the required fields with empty lists and no draft", () => {
    expect(validateEntry(CONVERSATION, TODAY, STUDENT)).toEqual({
      ok: true,
      input: {
        kind: "conversation",
        occurredOn: "2026-10-21",
        mode: "call",
        spokeWith: "student",
        durationMinutes: 30,
        summary: "Talked about the mock test.",
        notesHtml: null,
        actionItems: [],
        photos: [],
        flags: [],
        completeActionItemIds: [],
        draftId: null,
      },
    });
  });

  it("accepts every optional part", () => {
    const result = validateEntry(
      {
        ...CONVERSATION,
        notesHtml: "<p>Doing well</p>",
        actionItems: [
          { owner: "student", text: " Revise optics " },
          { owner: "parent", text: "Call back" },
        ],
        photoKeys: [PHOTO_A, PHOTO_B],
        flags: [{ recipient: "physics", comment: " Weak on optics " }, { recipient: "emotional_wellbeing" }],
        completeActionItemIds: [7, 7, 9],
        draftId: 12,
      },
      TODAY,
      STUDENT
    );
    expect(result).toEqual({
      ok: true,
      input: expect.objectContaining({
        notesHtml: "<p>Doing well</p>",
        actionItems: [
          { owner: "student", text: "Revise optics" },
          { owner: "parent", text: "Call back" },
        ],
        photos: [
          { s3Key: PHOTO_A, contentType: "image/jpeg" },
          { s3Key: PHOTO_B, contentType: "image/png" },
        ],
        flags: [
          { recipient: "physics", comment: "Weak on optics" },
          { recipient: "emotional_wellbeing", comment: null },
        ],
        completeActionItemIds: [7, 9],
        draftId: 12,
      }),
    });
  });

  it("reports missing session details and summary in field order", () => {
    const result = validateEntry({ kind: "conversation", summary: " " }, TODAY, STUDENT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors)).toEqual(["occurredOn", "mode", "spokeWith", "durationMinutes", "summary"]);
    expect(result.fieldErrors.summary).toBe("Add a summary.");
  });

  it("refuses notes that aren't text, or are too large", () => {
    expect(validateEntry({ ...CONVERSATION, notesHtml: 42 }, TODAY, STUDENT)).toEqual({
      ok: false,
      fieldErrors: { notesHtml: "Notes must be text." },
    });
    expect(validateEntry({ ...CONVERSATION, notesHtml: `<p>${"a".repeat(110_000)}</p>` }, TODAY, STUDENT)).toEqual({
      ok: false,
      fieldErrors: { notesHtml: "Notes must be 100 KB or less." },
    });
  });

  it("refuses lists that aren't lists", () => {
    expect(
      validateEntry(
        { ...CONVERSATION, actionItems: "x", photoKeys: "x", flags: "x", completeActionItemIds: "x" },
        TODAY,
        STUDENT
      )
    ).toEqual({
      ok: false,
      fieldErrors: {
        actionItems: "Action Items must be a list.",
        photoKeys: "Photos must be a list.",
        flags: "Mentor Flags must be a list.",
        completeActionItemIds: "Choose Action Items from the list.",
      },
    });
  });

  it("keys Action Item errors per item", () => {
    const result = validateEntry(
      { ...CONVERSATION, actionItems: [null, { owner: "teacher", text: "Ok" }] },
      TODAY,
      STUDENT
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        "actionItems.0.owner": "Choose who owns this Action Item.",
        "actionItems.0.text": "Add the Action Item.",
        "actionItems.1.owner": "Choose who owns this Action Item.",
      },
    });
  });

  it("keys photo errors per key and caps photos at five", () => {
    expect(
      validateEntry(
        { ...CONVERSATION, photoKeys: [PHOTO_A, PHOTO_A, "other-prefix/photo.jpg", 5] },
        TODAY,
        STUDENT
      )
    ).toEqual({
      ok: false,
      fieldErrors: {
        "photoKeys.1": "Each photo can be attached once.",
        "photoKeys.2": "This photo isn't this Mentee's. Remove it and add it again.",
        "photoKeys.3": "This photo isn't this Mentee's. Remove it and add it again.",
      },
    });
    expect(validateEntry({ ...CONVERSATION, photoKeys: Array(6).fill(PHOTO_A) }, TODAY, STUDENT)).toEqual({
      ok: false,
      fieldErrors: { photoKeys: "A Conversation can have at most five photos." },
    });
  });

  it("keys Mentor Flag errors per flag", () => {
    expect(
      validateEntry(
        {
          ...CONVERSATION,
          flags: [{ recipient: "maths" }, { recipient: "maths" }, { recipient: "music", comment: 3 }],
        },
        TODAY,
        STUDENT
      )
    ).toEqual({
      ok: false,
      fieldErrors: {
        "flags.1.recipient": "Each Flag Recipient can be raised once.",
        "flags.2.recipient": "Choose who the flag is for.",
        "flags.2.comment": "The comment must be text.",
      },
    });
  });

  it.each([[[0]], [[1.5]], [["3"]]])("refuses Action Item ids %j", (ids) => {
    expect(validateEntry({ ...CONVERSATION, completeActionItemIds: ids }, TODAY, STUDENT)).toEqual({
      ok: false,
      fieldErrors: { completeActionItemIds: "Choose Action Items from the list." },
    });
  });

  it.each([0, -1, 2.5, "12"])("refuses draftId %j", (draftId) => {
    expect(validateEntry({ ...CONVERSATION, draftId }, TODAY, STUDENT)).toEqual({
      ok: false,
      fieldErrors: { draftId: "This Conversation Draft isn't valid. Reload and try again." },
    });
  });
});
