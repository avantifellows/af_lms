import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/db-service-config", () => ({ getDbServiceConfig: vi.fn() }));

import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { findStep, groupHistory, istMoment, listHistory, planRestore, runRestore } from "./mass-restore";

const mockQuery = vi.mocked(query);
const mockFetch = vi.fn();
/** Ravi's bulk edit: history rows 40 to 45. */
const STEP = {
  fromId: "40",
  toId: "45",
  source: "bulk_upload",
  actorEmail: "ravi@avantifellows.org",
  actorRole: "alumni_manager",
  at: "2026-11-23T11:40:00Z",
};
const ACTOR = { actorEmail: "a@avantifellows.org", actorRole: "alumni_manager" };

/** A candidate row as loadCandidates returns it (`a.*` + extras). */
const candidate = (overrides: Record<string, unknown>) => ({
  id: "8340",
  person: "Ampoli Ram Charan",
  school_name: "JNV Adilabad",
  row_version: "v5",
  changed_later: false,
  contact_status: "Contacted - Positive Response",
  skilling_programs: null,
  target_on: "2026-11-23",
  target_data: { contact_status: "Contacted - Unreachable", skilling_programs: null },
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

describe("findStep", () => {
  it("reads who made the step from its rows; null when the last row isn't theirs", async () => {
    mockQuery.mockResolvedValueOnce([{ source: "bulk_upload", actor_email: "ravi@x", actor_role: "alumni_manager", at: STEP.at, last_ok: true }] as never);
    expect(await findStep("40", "45")).toEqual({ fromId: "40", toId: "45", source: "bulk_upload", actorEmail: "ravi@x", actorRole: "alumni_manager", at: STEP.at });
    mockQuery.mockResolvedValueOnce([{ source: "call", actor_email: "x", actor_role: null, at: STEP.at, last_ok: false }] as never);
    expect(await findStep("40", "99")).toBeNull();
    mockQuery.mockResolvedValueOnce([] as never);
    expect(await findStep("1", "2")).toBeNull();
  });
});

describe("planRestore (undo one step)", () => {
  it("picks only the step's own rows (range + kind + person), narrowed to the school in SQL", async () => {
    candidates();
    await planRestore({ kind: "school", code: "59525" }, STEP);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("j.id BETWEEN $1::bigint AND $2::bigint AND j.source = $3");
    expect(sql).toContain("j.actor_email IS NOT DISTINCT FROM $4::text AND j.actor_role IS NOT DISTINCT FROM $5::text");
    expect(sql).toContain("j.id < st.first_id"); // the version from just before their part of the step
    expect(sql).toContain("l.id > st.last_id"); // changed again after it
    expect(sql).toContain("WHERE sch.code = $6");
    expect(params).toEqual(["40", "45", "bulk_upload", "ravi@avantifellows.org", "alumni_manager", "59525"]);
  });

  it("all alumni: no school filter", async () => {
    candidates();
    await planRestore({ kind: "all" }, STEP);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("sch.code = $");
    expect(params).toHaveLength(5);
  });

  it("lists who goes back to before the step, and how", async () => {
    candidates(candidate({}));
    const plan = await planRestore({ kind: "all" }, STEP);
    expect(plan).toEqual({
      items: [{
        alumniId: "8340",
        name: "Ampoli Ram Charan",
        school: "JNV Adilabad",
        versionOn: "2026-11-23",
        version: "v5",
        changes: [{ label: "Contact status", before: "Contacted - Positive Response", after: "Contacted - Unreachable" }],
      }],
      changedLater: [],
    });
  });

  it("someone the step created goes back to no answers (their answers from the step are cleared)", async () => {
    candidates(candidate({ id: "9001", person: "New One", target_data: null, target_on: null, contact_status: "Not Contacted" }));
    const plan = await planRestore({ kind: "all" }, STEP);
    expect(plan.items[0]).toMatchObject({ versionOn: "", changes: [{ before: "Not Contacted", after: "" }] });
  });

  it("leaves out anyone already back, and lists anyone changed again after the step", async () => {
    candidates(candidate({ contact_status: "Contacted - Unreachable" }), candidate({ id: "9002", person: "Called Later", changed_later: true }));
    const plan = await planRestore({ kind: "all" }, STEP);
    expect(plan.items).toEqual([]);
    expect(plan.changedLater).toEqual([{ alumniId: "9002", name: "Called Later", school: "JNV Adilabad" }]);
  });

  it("an older version predating a field leaves that field as it is", async () => {
    candidates(candidate({ skilling_programs: "NPTEL", target_data: { contact_status: "Contacted - Unreachable" } }));
    const plan = await planRestore({ kind: "all" }, STEP);
    expect(plan.items[0].changes.map((c) => c.label)).toEqual(["Contact status"]);
  });
});

describe("runRestore", () => {
  it("writes each one as a correction with only the fields that differ (blank clears)", async () => {
    candidates(candidate({ skilling_programs: "E2E" }));
    const results = await runRestore({ kind: "school", code: "59525" }, STEP, ["8340"], ACTOR);
    expect(results).toEqual([
      { alumniId: "8340", name: "Ampoli Ram Charan", result: "restored", changed: ["Contact status", "Skilling programs"] },
    ]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://db.test/api/alumni/8340/journey");
    expect(JSON.parse(init.body)).toMatchObject({
      source: "correction",
      data: { contact_status: "Contacted - Unreachable", skilling_programs: null },
      actor_email: "a@avantifellows.org",
      notes: `Undid the bulk edit by ravi@avantifellows.org on ${istMoment(new Date(STEP.at))} (history #40–#45)`,
    });
    expect(mockQuery.mock.calls[0][1]).toEqual(["40", "45", "bulk_upload", "ravi@avantifellows.org", "alumni_manager", "59525", ["8340"]]);
  });

  it("re-checks: already back, changed again after the step, or not in it → nothing written", async () => {
    candidates(candidate({ contact_status: "Contacted - Unreachable" }), candidate({ id: "9002", changed_later: true }));
    const results = await runRestore({ kind: "all" }, STEP, ["8340", "9002", "777"], ACTOR);
    expect(results.map((r) => r.result)).toEqual(["unchanged", "skipped", "unchanged"]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips anyone saved after the preview instead of reverting that save unseen", async () => {
    candidates(candidate({ row_version: "v6" }), candidate({ id: "8341", row_version: "v5" }));
    const results = await runRestore({ kind: "all" }, STEP, ["8340", "8341"], ACTOR, { "8340": "v5", "8341": "v5" });
    expect(results.map((r) => r.result)).toEqual(["skipped", "restored"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://db.test/api/alumni/8341/journey");
  });

  it("reports a DB Service refusal for that alumnus and goes on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    candidates(candidate({}), candidate({ id: "8341" }));
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "bad" });
    const results = await runRestore({ kind: "all" }, STEP, ["8340", "8341"], ACTOR);
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

  it("someone else's save in the middle doesn't split a step; each step knows its first and last row", () => {
    const groups = groupHistory([
      row("9", "2026-11-23T10:44:00Z"),
      row("8", "2026-11-23T10:43:30Z", { source: "call", actor_email: "priya@x", alumni_id: "p1" }),
      row("7", "2026-11-23T10:43:00Z"),
    ]);
    expect(groups.map((g) => [g.id, g.lastId, g.by, g.alumni])).toEqual([
      ["7", "9", "ravi@x", 2],
      ["8", "8", "priya@x", 1],
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
