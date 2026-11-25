import { describe, it, expect } from "vitest";
import {
  acknowledgementLabel,
  acknowledgementSlots,
  parseAcknowledgementSession,
} from "./exam-acknowledgements";

describe("acknowledgementSlots", () => {
  it("gives JEE Mains one slot per session applied for", () => {
    expect(acknowledgementSlots("JEE Mains", [2, 1])).toEqual([1, 2]);
    expect(acknowledgementSlots("JEE Mains", [1])).toEqual([1]);
  });

  it("gives JEE Mains no slot until a session is applied for", () => {
    expect(acknowledgementSlots("JEE Mains", null)).toEqual([]);
    expect(acknowledgementSlots("JEE Mains", [])).toEqual([]);
  });

  it("gives every other exam a single slot with no session", () => {
    expect(acknowledgementSlots("NEET", null)).toEqual([null]);
    expect(acknowledgementSlots("KCET", [])).toEqual([null]);
  });

  it("follows the stored sessions, as the DB Service does, even on another exam", () => {
    // The LMS never stores sessions on a non-JEE exam, but another writer
    // could; the DB Service would then require a session, so the slots do too.
    expect(acknowledgementSlots("NEET", [1])).toEqual([1]);
  });
});

describe("acknowledgementLabel", () => {
  it("names the session, or none", () => {
    expect(acknowledgementLabel(2)).toBe("Session 2 exam acknowledgement");
    expect(acknowledgementLabel(null)).toBe("Exam acknowledgement");
  });
});

describe("parseAcknowledgementSession", () => {
  it("accepts a session among the slots", () => {
    expect(parseAcknowledgementSession("2", [1, 2])).toEqual({ ok: true, session: 2 });
  });

  it("accepts no session for a single slot", () => {
    expect(parseAcknowledgementSession(null, [null])).toEqual({ ok: true, session: null });
    expect(parseAcknowledgementSession(" ", [null])).toEqual({ ok: true, session: null });
  });

  it("refuses a session outside the slots", () => {
    expect(parseAcknowledgementSession("2", [1])).toEqual({
      ok: false,
      error: "Session 2 is not a session this Student applied for",
    });
    expect(parseAcknowledgementSession("1", [null]).ok).toBe(false);
  });

  it("refuses a missing session where sessions are required", () => {
    expect(parseAcknowledgementSession(null, [1, 2])).toEqual({
      ok: false,
      error: "Pick the session this acknowledgement is for",
    });
  });

  it("refuses a value that isn't a number", () => {
    expect(parseAcknowledgementSession("1a", [1])).toEqual({
      ok: false,
      error: "exam_session is not valid",
    });
  });
});
