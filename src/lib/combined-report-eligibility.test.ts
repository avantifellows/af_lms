import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/db";
import {
  getSessionWindow,
  evaluateGenerationEligibility,
} from "./combined-report-eligibility";

const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

function stubEndTime(end_time: string | null | undefined) {
  mockQuery.mockResolvedValue(
    end_time === undefined ? [] : [{ end_time }],
  );
}

describe("getSessionWindow", () => {
  it("treats a stored end_time as IST wall-clock, not UTC", async () => {
    // 2026-06-23 23:33 IST == 2026-06-23 18:03 UTC.
    stubEndTime("2026-06-23 23:33:00");
    const w = await getSessionWindow("S1", new Date("2026-06-23T18:04:00Z"));
    expect(w.endTimeUtcIso).toBe("2026-06-23T18:03:00.000Z");
    expect(w.hasEnded).toBe(true);
  });

  it("still blocks during the 5h30m window a UTC misreading would unblock", async () => {
    // The bug this guards: parsed as UTC, end looks like 23:33Z and 19:00Z
    // would read as 'before end' — but in IST terms 19:00Z is 00:30 IST, i.e.
    // after the 23:33 IST close. Conversely a naive reading at 18:00Z would
    // think the session already ended when it has 3 minutes left.
    stubEndTime("2026-06-23 23:33:00");
    const during = await getSessionWindow("S1", new Date("2026-06-23T18:00:00Z"));
    expect(during.hasEnded).toBe(false);

    const after = await getSessionWindow("S1", new Date("2026-06-23T18:03:00Z"));
    expect(after.hasEnded).toBe(true);
  });

  it("handles the ISO-with-offset form without double-converting", async () => {
    stubEndTime("2026-06-23T18:03:00Z");
    const w = await getSessionWindow("S1", new Date("2026-06-23T18:04:00Z"));
    expect(w.endTimeUtcIso).toBe("2026-06-23T18:03:00.000Z");
    expect(w.hasEnded).toBe(true);
  });

  it("fails open when the session row is absent", async () => {
    stubEndTime(undefined);
    const w = await getSessionWindow("missing", new Date("2020-01-01T00:00:00Z"));
    expect(w.hasEnded).toBe(true);
    expect(w.endTimeUtcIso).toBeNull();
  });

  it("fails open when end_time is null or unparseable", async () => {
    stubEndTime(null);
    expect((await getSessionWindow("S1")).hasEnded).toBe(true);

    stubEndTime("not-a-date");
    const w = await getSessionWindow("S1");
    expect(w.hasEnded).toBe(true);
    expect(w.endTimeUtcIso).toBeNull();
  });

  it("is inclusive at the boundary instant", async () => {
    stubEndTime("2026-06-23 23:33:00");
    const w = await getSessionWindow("S1", new Date("2026-06-23T18:03:00.000Z"));
    expect(w.hasEnded).toBe(true);
  });
});

describe("evaluateGenerationEligibility", () => {
  const ended = { endTimeUtcIso: "2026-06-23T18:03:00.000Z", hasEnded: true };
  const open = { endTimeUtcIso: "2026-12-31T18:03:00.000Z", hasEnded: false };

  it("blocks while the session is still open, even with no jobs", () => {
    expect(evaluateGenerationEligibility(open, [])).toEqual({
      allowed: false,
      reason: "session_not_ended",
    });
  });

  it("allows a first generation once the session has ended", () => {
    expect(evaluateGenerationEligibility(ended, [])).toEqual({ allowed: true });
  });

  it.each(["queued", "started", "processing"])(
    "blocks a duplicate while a %s job exists",
    (status) => {
      expect(evaluateGenerationEligibility(ended, [{ status }])).toEqual({
        allowed: false,
        reason: "job_in_progress",
      });
    },
  );

  it("blocks regeneration once a job is done", () => {
    expect(
      evaluateGenerationEligibility(ended, [{ status: "done" }]),
    ).toEqual({ allowed: false, reason: "already_generated" });
  });

  it("still allows generation when every previous job errored", () => {
    expect(
      evaluateGenerationEligibility(ended, [
        { status: "errored" },
        { status: "errored" },
      ]),
    ).toEqual({ allowed: true });
  });

  it("prefers the session gate over job state when both would block", () => {
    expect(
      evaluateGenerationEligibility(open, [{ status: "done" }]),
    ).toEqual({ allowed: false, reason: "session_not_ended" });
  });
});
