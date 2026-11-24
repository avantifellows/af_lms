import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/db-service-config", () => ({ getDbServiceConfig: vi.fn() }));

import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { findMarker, groupHistory, istMoment, listHistory, planRestore, runRestore } from "./mass-restore";

const mockQuery = vi.mocked(query);
const mockFetch = vi.fn();
/** Restore to just before history row 40, recorded at this moment. */
const AT = { id: "40", at: "2026-11-23T11:40:00Z" };
const ACTOR = { actorEmail: "a@avantifellows.org", actorRole: "alumni_manager" };

/** A candidate row as loadCandidates returns it (`a.*` + extras). */
const candidate = (overrides: Record<string, unknown>) => ({
  id: "8340",
  person: "Ampoli Ram Charan",
  school_name: "JNV Adilabad",
  row_version: "v5",
  added_after: false,
  contact_status: "Contacted - Positive Response",
  skilling_programs: null,
  target_on: "2026-11-23",
  target_data: { contact_status: "Contacted - Unreachable", skilling_programs: null },
  first_source: "initial",
  first_on: "2026-10-12",
  first_data: { contact_status: "Contacted - Positive Response" },
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.mocked(getDbServiceConfig).mockReturnValue({
    baseUrl: "https://db.test/api",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
  });
  mockFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({}), text: async () => "" });
});
afterEach(() => vi.unstubAllGlobals());

/** The candidate query's rows (college/branch name lookups don't run: no ids here). */
const candidates = (...rows: Record<string, unknown>[]) => mockQuery.mockResolvedValueOnce(rows as never);

describe("planRestore", () => {
  it("narrows to the school in SQL and to alumni with history from the marker row on, or added since", async () => {
    candidates();
    await planRestore({ kind: "school", code: "59525" }, AT);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("j.id >= $1::bigint");
    expect(sql).toContain("j.id < $1::bigint"); // the version to go back to: the latest row before the marker
    expect(sql).toContain("a.inserted_at >= $2::timestamptz AT TIME ZONE 'UTC'");
    expect(sql).toContain("AND sch.code = $3");
    expect(params).toEqual(["40", "2026-11-23T11:40:00Z", "59525"]);
  });

  it("finds the marker row", async () => {
    mockQuery.mockResolvedValueOnce([{ id: "40", at: "2026-11-23T11:40:00Z" }] as never).mockResolvedValueOnce([] as never);
    expect(await findMarker("40")).toEqual({ id: "40", at: "2026-11-23T11:40:00Z" });
    expect(await findMarker("41")).toBeNull();
  });

  it("all alumni: no school filter", async () => {
    candidates();
    await planRestore({ kind: "all" }, AT);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("sch.code = $");
    expect(params).toEqual(["40", "2026-11-23T11:40:00Z"]);
  });

  it("goes back to the version at or before the moment, listing what changes", async () => {
    candidates(candidate({}));
    const plan = await planRestore({ kind: "all" }, AT);
    expect(plan.items).toEqual([
      {
        alumniId: "8340",
        name: "Ampoli Ram Charan",
        school: "JNV Adilabad",
        versionOn: "2026-11-23",
        version: "v5",
        changes: [{ label: "Contact status", before: "Contacted - Positive Response", after: "Contacted - Unreachable" }],
      },
    ]);
  });

  it("first change after the moment: back to the initial copy; no initial copy: back to no answers", async () => {
    candidates(
      candidate({ target_data: null, target_on: null, contact_status: "Not Contacted" }),
      candidate({ id: "9001", person: "New One", target_data: null, target_on: null, first_source: "call", first_data: {}, contact_status: "Not Contacted" }),
    );
    const plan = await planRestore({ kind: "all" }, AT);
    expect(plan.items[0]).toMatchObject({ versionOn: "2026-10-12", changes: [{ after: "Contacted - Positive Response" }] });
    expect(plan.items[1]).toMatchObject({ versionOn: "", changes: [{ before: "Not Contacted", after: "" }] });
  });

  it("leaves out alumni already as they were, and lists ones added after the moment", async () => {
    candidates(
      candidate({ contact_status: "Contacted - Unreachable" }),
      candidate({ id: "9002", person: "Added Later", added_after: true }),
    );
    const plan = await planRestore({ kind: "all" }, AT);
    expect(plan.items).toEqual([]);
    expect(plan.addedAfter).toEqual([{ alumniId: "9002", name: "Added Later", school: "JNV Adilabad" }]);
  });
});

describe("runRestore", () => {
  it("writes each one as a correction with only the fields that differ (blank clears)", async () => {
    candidates(candidate({ skilling_programs: "E2E" }));
    const results = await runRestore({ kind: "school", code: "59525" }, AT, ["8340"], ACTOR);
    expect(results).toEqual([
      { alumniId: "8340", name: "Ampoli Ram Charan", result: "restored", changed: ["Contact status", "Skilling programs"] },
    ]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://db.test/api/alumni/8340/journey");
    expect(JSON.parse(init.body)).toMatchObject({
      source: "correction",
      data: { contact_status: "Contacted - Unreachable", skilling_programs: null },
      actor_email: "a@avantifellows.org",
      notes: `Mass restore to just before history #40 (${istMoment(new Date(AT.at))}, school 59525)`,
    });
    expect(mockQuery.mock.calls[0][1]).toEqual(["40", "2026-11-23T11:40:00Z", "59525", ["8340"]]);
  });

  it("re-checks: already back, added after, or outside the scope → nothing written", async () => {
    candidates(candidate({ contact_status: "Contacted - Unreachable" }), candidate({ id: "9002", added_after: true }));
    const results = await runRestore({ kind: "all" }, AT, ["8340", "9002", "777"], ACTOR);
    expect(results.map((r) => r.result)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips anyone saved after the preview instead of reverting that save unseen", async () => {
    candidates(candidate({ row_version: "v6" }), candidate({ id: "8341", row_version: "v5" }));
    const results = await runRestore({ kind: "all" }, AT, ["8340", "8341"], ACTOR, { "8340": "v5", "8341": "v5" });
    expect(results.map((r) => r.result)).toEqual(["skipped", "restored"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://db.test/api/alumni/8341/journey");
  });

  it("reports a DB Service refusal for that alumnus and goes on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    candidates(candidate({}), candidate({ id: "8341" }));
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "bad" });
    const results = await runRestore({ kind: "all" }, AT, ["8340", "8341"], ACTOR);
    expect(results.map((r) => r.result)).toEqual(["error", "restored"]);
  });
});

describe("version history steps", () => {
  const row = (id: string, at: string, overrides: Record<string, unknown> = {}) => ({
    id, alumni_id: `a${id}`, source: "bulk_upload" as const, actor_email: "ravi@x", actor_role: "alumni_manager", notes: null, at, ...overrides,
  });

  it("groups saves of one kind by one person within 2 minutes of each other (newest first)", () => {
    const groups = groupHistory([
      row("9", "2026-11-23T10:44:10Z"),
      row("8", "2026-11-23T10:43:00Z"),
      row("7", "2026-11-23T10:42:00Z", { alumni_id: "a8" }),
      row("6", "2026-11-23T10:41:00Z", { source: "call", notes: "Wrong Phone number" }),
      row("5", "2026-11-23T10:30:00Z", { actor_email: null, actor_role: "import" }),
      row("4", "2026-11-23T10:20:00Z"),
    ]);
    expect(groups.map((g) => [g.id, g.source, g.by, g.alumni, g.start, g.end, g.note])).toEqual([
      ["7", "bulk_upload", "ravi@x", 2, "2026-11-23T10:42:00Z", "2026-11-23T10:44:10Z", ""],
      ["6", "call", "ravi@x", 1, "2026-11-23T10:41:00Z", "2026-11-23T10:41:00Z", "Wrong Phone number"],
      ["5", "bulk_upload", "CSV import", 1, "2026-11-23T10:30:00Z", "2026-11-23T10:30:00Z", ""],
      ["4", "bulk_upload", "ravi@x", 1, "2026-11-23T10:20:00Z", "2026-11-23T10:20:00Z", ""],
    ]);
  });

  it("reads the newest rows without the initial copies, narrowed to the school's alumni", async () => {
    mockQuery.mockResolvedValueOnce([] as never);
    await listHistory({ kind: "school", code: "59525" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE j.source <> 'initial'");
    expect(sql).toContain(") sch ON sch.code = $1");
    expect(sql).toContain("ORDER BY j.id DESC");
    expect(params).toEqual(["59525"]);

    mockQuery.mockClear();
    mockQuery.mockResolvedValueOnce([] as never);
    await listHistory({ kind: "all" });
    expect(mockQuery.mock.calls[0][0]).not.toContain("enrollment_record");
  });
});
