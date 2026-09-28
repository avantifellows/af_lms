import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { recordUsageEvent } from "./usage-events";

const mockQuery = vi.mocked(query);

describe("recordUsageEvent", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("inserts the event, deduping via ON CONFLICT", async () => {
    mockQuery.mockResolvedValue([]);

    await recordUsageEvent({
      event: "tab_viewed",
      email: "pm@avantifellows.org",
      schoolCode: "59525",
      detail: "performance",
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO lms_usage_events");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(params).toEqual([
      "tab_viewed",
      "pm@avantifellows.org",
      null,
      "59525",
      null,
      "performance",
      "{}",
    ]);
  });

  it("never throws when the write fails", async () => {
    mockQuery.mockRejectedValue(new Error("relation does not exist"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      recordUsageEvent({ event: "sign_in", email: "a@b.org" })
    ).resolves.toBeUndefined();
  });
});
