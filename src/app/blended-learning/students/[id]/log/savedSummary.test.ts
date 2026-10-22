import { describe, expect, it } from "vitest";

import { initialEntryValues, type EntryFormValues } from "./logEntryPayload";
import type { PickedPhoto } from "./PhotoPicker";
import { savedEntry, savedRows } from "./savedSummary";

const TODAY = "2026-10-22";

function values(change: Partial<EntryFormValues> = {}): EntryFormValues {
  return { ...initialEntryValues(null, TODAY), ...change };
}

const PHOTOS: PickedPhoto[] = [
  { id: 1, previewUrl: null, status: "done", s3Key: "a" },
  { id: 2, previewUrl: null, status: "done", s3Key: "b" },
];

describe("savedEntry", () => {
  it("records what the form sent: Action Items with text, uploaded photos, ticks and raised flags", () => {
    const entry = savedEntry(
      values({
        duration: "25",
        actionItems: [
          { key: 1, owner: "student", text: "Revise" },
          { key: 2, owner: "mentor", text: " " },
        ],
        ticked: new Set([7, 8]),
        flags: { maths: "  ", emotional_wellbeing: "Upset" },
      }),
      PHOTOS
    );
    expect(entry).toEqual({
      kind: "conversation",
      occurredOn: TODAY,
      mode: "call",
      spokeWith: "student",
      durationMinutes: 25,
      actionItemsAdded: 1,
      actionItemsClosed: 2,
      photos: 2,
      flags: [
        { recipient: "emotional_wellbeing", commented: true },
        { recipient: "maths", commented: false },
      ],
    });
  });
});

describe("savedRows", () => {
  it("lists a Conversation's session, counts and flags", () => {
    const entry = savedEntry(
      values({ spokeWith: "both", duration: "25", ticked: new Set([7]), flags: { physics: "Optics", maths: "" } }),
      PHOTOS
    );
    expect(savedRows(entry)).toEqual([
      { label: "Conversation", value: "22 Oct 2026 · Call · Student and parent" },
      { label: "Duration", value: "25 min" },
      { label: "Action items added", value: "0" },
      { label: "Action items closed", value: "1" },
      { label: "Photos attached", value: "2" },
      { label: "Flagged to the Physics teacher", value: "With your comment" },
      { label: "Flagged to the Maths teacher", value: "No comment" },
    ]);
  });

  it("leaves out nothing closed, no photos and no duration", () => {
    const entry = savedEntry(values({ mode: "in_person", spokeWith: "parent_or_sibling" }), []);
    expect(savedRows(entry)).toEqual([
      { label: "Conversation", value: "22 Oct 2026 · In person · Parent or sibling" },
      { label: "Action items added", value: "0" },
    ]);
  });

  it("gives an Attempt only its date", () => {
    expect(savedRows(savedEntry(values({ kind: "attempt", duration: "20" }), PHOTOS))).toEqual([
      { label: "Attempt", value: "22 Oct 2026" },
    ]);
  });
});
