import { describe, expect, it } from "vitest";

import {
  aiTestInsightsSessionDraftUrl,
  aiTestInsightsSessionsUrl,
  SESSION_NOTES_LABELS,
  SESSION_NOTES_MAX_LENGTH,
  validateSessionNotes,
} from "./ai-test-insights-session-notes-rules";

// The Session Notes draft rule (#574): each text field is a string or null
// within 2,000 characters, and the date is null or a real `YYYY-MM-DD` date.
const NOTES = {
  sessionDate: "2026-11-27",
  areasOfConcern: "Struggles with rotational motion [marker-574]",
  immediateActions: "Revise torque problems twice a week",
  otherNotes: null,
};

describe("validateSessionNotes, draft rule", () => {
  it("names the four fields and the 2,000-character limit", () => {
    expect(SESSION_NOTES_LABELS).toEqual({
      sessionDate: "Date of conversation",
      areasOfConcern: "Areas of concern",
      immediateActions: "Immediate actions",
      otherNotes: "Other notes (optional)",
    });
    expect(SESSION_NOTES_MAX_LENGTH).toBe(2000);
  });

  it("accepts notes as typed, keeping the text exactly", () => {
    const typed = { ...NOTES, areasOfConcern: "  spaces kept  ", otherNotes: "" };

    expect(validateSessionNotes(typed, "draft")).toEqual({ ok: true, notes: typed });
  });

  it("accepts every field null: a draft may be empty", () => {
    const empty = { sessionDate: null, areasOfConcern: null, immediateActions: null, otherNotes: null };

    expect(validateSessionNotes(empty, "draft")).toEqual({ ok: true, notes: empty });
  });

  it("accepts a field of exactly 2,000 characters and refuses 2,001", () => {
    expect(validateSessionNotes({ ...NOTES, immediateActions: "a".repeat(2000) }, "draft").ok).toBe(true);

    expect(validateSessionNotes({ ...NOTES, immediateActions: "a".repeat(2001) }, "draft")).toEqual({
      ok: false,
      field: "immediateActions",
      error: "Immediate actions is over the 2,000-character limit.",
    });
  });

  it.each(["areasOfConcern", "immediateActions", "otherNotes"] as const)(
    "refuses %s over the limit",
    (field) => {
      const result = validateSessionNotes({ ...NOTES, [field]: "x".repeat(2001) }, "draft");

      expect(result).toMatchObject({ ok: false, field });
    },
  );

  it.each([
    ["an impossible day", "2026-02-30"],
    ["a 13th month", "2026-13-01"],
    ["another format", "27/11/2026"],
    ["a date and time", "2026-11-27T00:00:00Z"],
    ["an empty string", ""],
  ])("refuses %s as the date", (_label, sessionDate) => {
    expect(validateSessionNotes({ ...NOTES, sessionDate }, "draft")).toEqual({
      ok: false,
      field: "sessionDate",
      error: "Date of conversation is not a real date.",
    });
  });

  it("accepts a leap day", () => {
    expect(validateSessionNotes({ ...NOTES, sessionDate: "2028-02-29" }, "draft").ok).toBe(true);
  });

  it.each([
    ["a number", { ...NOTES, areasOfConcern: 5 }, "areasOfConcern"],
    ["a missing field", { sessionDate: null, areasOfConcern: null, immediateActions: null }, "otherNotes"],
    ["an array", { ...NOTES, immediateActions: ["a"] }, "immediateActions"],
    ["a numeric date", { ...NOTES, sessionDate: 20261127 }, "sessionDate"],
  ])("refuses %s", (_label, input, field) => {
    expect(validateSessionNotes(input, "draft")).toMatchObject({ ok: false, field });
  });

  it.each([null, "notes", ["a"], 7])("refuses %j, which is not an object of fields", (input) => {
    expect(validateSessionNotes(input, "draft").ok).toBe(false);
  });

  it("returns only the four fields", () => {
    const result = validateSessionNotes({ ...NOTES, expectedRevision: 3, extra: "x" }, "draft");

    expect(result).toEqual({ ok: true, notes: NOTES });
  });
});

// The final rule (#575): the draft rule, plus Areas of concern and Immediate
// actions non-blank after trim, plus a date that is present and not after
// "today", which the caller passes.
describe("validateSessionNotes, final rule", () => {
  const TODAY = "2026-11-28";

  it("accepts notes dated today, keeping the text as typed, with Other notes blank", () => {
    const typed = { ...NOTES, sessionDate: "2026-11-28", areasOfConcern: "  spaces kept  ", otherNotes: "" };

    expect(validateSessionNotes(typed, "final", TODAY)).toEqual({ ok: true, notes: typed });
  });

  it("accepts Other notes null and an earlier date", () => {
    expect(validateSessionNotes({ ...NOTES, sessionDate: "2025-01-01" }, "final", TODAY).ok).toBe(true);
  });

  it("refuses a date one day after today", () => {
    expect(validateSessionNotes({ ...NOTES, sessionDate: "2026-11-29" }, "final", TODAY)).toEqual({
      ok: false,
      field: "sessionDate",
      error: "Date of conversation can't be after today.",
    });
  });

  it("refuses a missing date", () => {
    expect(validateSessionNotes({ ...NOTES, sessionDate: null }, "final", TODAY)).toEqual({
      ok: false,
      field: "sessionDate",
      error: "Date of conversation is required.",
    });
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["whitespace only", " \n\t "],
  ])("refuses Areas of concern %s", (_label, areasOfConcern) => {
    expect(validateSessionNotes({ ...NOTES, areasOfConcern }, "final", TODAY)).toEqual({
      ok: false,
      field: "areasOfConcern",
      error: "Areas of concern is required.",
    });
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("refuses Immediate actions %s", (_label, immediateActions) => {
    expect(validateSessionNotes({ ...NOTES, immediateActions }, "final", TODAY)).toEqual({
      ok: false,
      field: "immediateActions",
      error: "Immediate actions is required.",
    });
  });

  it("still applies the draft rule: a field over the limit and an impossible date", () => {
    expect(validateSessionNotes({ ...NOTES, otherNotes: "a".repeat(2001) }, "final", TODAY)).toMatchObject({
      ok: false,
      field: "otherNotes",
    });
    expect(validateSessionNotes({ ...NOTES, sessionDate: "2026-02-30" }, "final", TODAY)).toMatchObject({
      ok: false,
      field: "sessionDate",
      error: "Date of conversation is not a real date.",
    });
  });

  it("leaves the draft rule as it was: blank fields and a future date pass", () => {
    const empty = { sessionDate: "2026-12-31", areasOfConcern: null, immediateActions: " ", otherNotes: null };

    expect(validateSessionNotes(empty, "draft").ok).toBe(true);
  });
});

describe("Session Notes routes", () => {
  it("builds the history and draft routes of a Student, carrying the page's centre", () => {
    expect(aiTestInsightsSessionsUrl(1001, null)).toBe("/api/ai-test-insights/students/1001/sessions");
    expect(aiTestInsightsSessionsUrl(1001, 302)).toBe("/api/ai-test-insights/students/1001/sessions?centre=302");
    expect(aiTestInsightsSessionDraftUrl(1001, null)).toBe("/api/ai-test-insights/students/1001/sessions/draft");
    expect(aiTestInsightsSessionDraftUrl(1001, 302)).toBe(
      "/api/ai-test-insights/students/1001/sessions/draft?centre=302",
    );
  });
});
