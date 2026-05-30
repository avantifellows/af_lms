import { afterEach, describe, expect, it, vi } from "vitest";
import { getTodayIST, isFutureIST, isPastOrTodayIST } from "./curriculum-date-helpers";

describe("curriculum date helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today's date in IST, not the server timezone date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T19:00:00.000Z"));

    expect(getTodayIST()).toBe("2026-03-01");
  });

  it("accepts today and past dates in IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T19:00:00.000Z"));

    expect(isPastOrTodayIST("2026-03-01")).toBe(true);
    expect(isPastOrTodayIST("2026-02-28")).toBe(true);
    expect(isFutureIST("2026-03-01")).toBe(false);
  });

  it("rejects tomorrow in IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T19:00:00.000Z"));

    expect(isPastOrTodayIST("2026-03-02")).toBe(false);
    expect(isFutureIST("2026-03-02")).toBe(true);
  });
});
