import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/db-service-config", () => ({ getDbServiceConfig: vi.fn() }));

import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import type { EntryContext } from "./entry";
import { journeyEnabled, loadJourney, postJourney, revertToJourney } from "./journey";

const mockQuery = vi.mocked(query);
const mockFetch = vi.fn();

const CONTEXT = {
  kind: "edit",
  ids: { enrollmentUserId: "86655", studentId: "86544", alumniId: "8340" },
  version: "v2",
} as EntryContext;
const ACTOR = { actorEmail: "a@avantifellows.org", actorRole: "alumni_manager" };

/** The alumni row as `SELECT a.*` returns it (bigint ids as text, like pg). */
const alumniRow = (values: Record<string, unknown>, version = "v2") => ({ id: "8340", row_version: version, ...values });

/** A journey row as loadJourney's query returns it. */
const journeyRow = (id: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  reported_on: "2026-06-10",
  recorded_at: "2026-06-10T05:00:00Z",
  source: "call",
  actor_email: "a@x",
  actor_role: "alumni_manager",
  notes: null,
  data,
  ...extra,
});

const posted = (call = 0) => JSON.parse(mockFetch.mock.calls[call][1].body);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.mocked(getDbServiceConfig).mockReturnValue({
    baseUrl: "https://db.test/api",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
  mockFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({}), text: async () => "{}" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("journeyEnabled", () => {
  it("is off unless ALUMNI_JOURNEY=on", () => {
    vi.stubEnv("ALUMNI_JOURNEY", "");
    expect(journeyEnabled()).toBe(false);
    vi.stubEnv("ALUMNI_JOURNEY", "on");
    expect(journeyEnabled()).toBe(true);
  });
});

describe("postJourney", () => {
  it("posts the call to the alumnus's journey endpoint", async () => {
    const result = await postJourney("8340", { ug_status: "Graduated" }, { source: "call", ...ACTOR, notes: "Updated by student" });
    expect(result).toEqual({ ok: true });
    expect(mockFetch.mock.calls[0][0]).toBe("https://db.test/api/alumni/8340/journey");
    expect(posted()).toEqual({
      reported_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      source: "call",
      data: { ug_status: "Graduated" },
      actor_email: "a@avantifellows.org",
      actor_role: "alumni_manager",
      notes: "Updated by student",
    });
  });

  it("reports the DB Service refusing", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "bad" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(postJourney("8340", {}, { source: "call", ...ACTOR })).resolves.toMatchObject({ ok: false, status: 502 });
  });
});

describe("loadJourney", () => {
  it("is unavailable while the table doesn't exist", async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    await expect(loadJourney("8340")).resolves.toEqual({ available: false, entries: [] });
  });

  it("lists newest first with what each row changed; ids show as names, pg text ids match JSON numbers", async () => {
    mockQuery
      .mockResolvedValueOnce([
        journeyRow("1", { ug_status: "Studying", college_id_ug: 5 }, { source: "initial", actor_email: null, actor_role: "system" }),
        journeyRow("7", { ug_status: "Graduated", college_id_ug: 5 }, { reported_on: "2026-06-08" }),
      ])
      .mockResolvedValueOnce([alumniRow({ ug_status: "Graduated", college_id_ug: "5" })])
      .mockResolvedValueOnce([{ id: "5", name: "IIT Bombay" }]);

    const { available, entries } = await loadJourney("8340");

    // By the numeric id: ordering by the text id put row 10 before row 2.
    expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY j\.id`?$/m);
    expect(available).toBe(true);
    expect(entries.map((e) => e.id)).toEqual(["7", "1"]);
    expect(entries[0]).toMatchObject({
      reportedOn: "2026-06-08",
      recordedAt: "2026-06-10T05:00:00Z",
      recordedBy: "a@x",
      changes: [{ column: "ug_status", label: expect.any(String), before: "Studying", after: "Graduated" }],
      matchesCurrent: true,
    });
    expect(entries[1]).toMatchObject({ recordedBy: "Automatic", changes: [], matchesCurrent: false });
  });
});

describe("revertToJourney", () => {
  const OLD = { reported_on: "2026-06-10", data: { current_org_name: "Infosys", current_ctc: 450000, current_job_city: null } };

  it("sends every differing field as a correction (blank clears it) with a note", async () => {
    mockQuery
      .mockResolvedValueOnce([OLD])
      .mockResolvedValueOnce([alumniRow({ current_org_name: "TCS", current_ctc: 900000, current_job_city: "Pune" })]);

    const result = await revertToJourney(CONTEXT, "7", "v2", ACTOR);

    expect(result).toEqual({ ok: true, changed: expect.arrayContaining([expect.any(String)]) });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://db.test/api/alumni/8340/journey");
    expect(posted()).toMatchObject({
      source: "correction",
      data: { current_org_name: "Infosys", current_ctc: 450000, current_job_city: null },
      actor_email: "a@avantifellows.org",
      notes: "Restored the record of 2026-06-10 (history #7)",
    });
  });

  it("refuses when the record changed since it was opened", async () => {
    mockQuery.mockResolvedValueOnce([OLD]).mockResolvedValueOnce([alumniRow({}, "v9")]);
    await expect(revertToJourney(CONTEXT, "7", "v2", ACTOR)).resolves.toMatchObject({ ok: false, status: 409 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses an entry of another alumnus", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(revertToJourney(CONTEXT, "99", "v2", ACTOR)).resolves.toMatchObject({ ok: false, status: 404 });
  });

  it("does nothing when the record already matches (numbers vs pg text)", async () => {
    mockQuery
      .mockResolvedValueOnce([OLD])
      .mockResolvedValueOnce([alumniRow({ current_org_name: "Infosys", current_ctc: "450000", current_job_city: null })]);
    await expect(revertToJourney(CONTEXT, "7", "v2", ACTOR)).resolves.toMatchObject({ ok: false, status: 400 });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
