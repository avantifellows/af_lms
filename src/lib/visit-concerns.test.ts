import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import type { UserPermission } from "@/lib/permissions";
import {
  findVisitSummaryConcern,
  getSchoolConcernPage,
  getSchoolWiseView,
  normalizeSchoolWiseSort,
  withRecurringSchoolsOnly,
} from "./visit-concerns";
import type { VisitSummaryFilters } from "./visit-summary-scope";
import { buildVisitsActor } from "./visits-policy";

const ADMIN = buildVisitsActor("admin@avantifellows.org", {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  read_only: false,
  program_ids: [1],
} as UserPermission);

// Sees only SC001, so it may see SC001's flags but not SC002's.
const SC001_PROGRAM_ADMIN = buildVisitsActor("program-admin@avantifellows.org", {
  email: "program-admin@avantifellows.org",
  level: 1,
  role: "program_admin",
  read_only: true,
  school_codes: ["SC001"],
  program_ids: [1],
} as UserPermission);

const NO_FILTERS: VisitSummaryFilters = { regions: [], schools: [], pms: [], forceEmpty: false };

beforeEach(() => {
  mockQuery.mockReset();
});

describe("normalizeSchoolWiseSort", () => {
  it("defaults to Recurring issues, most first", () => {
    expect(normalizeSchoolWiseSort()).toEqual({ sort: "recurring", dir: "desc" });
  });

  it("uses each column's own default direction", () => {
    expect(normalizeSchoolWiseSort("school_name")).toEqual({ sort: "school_name", dir: "asc" });
    expect(normalizeSchoolWiseSort("last_visit")).toEqual({ sort: "last_visit", dir: "desc" });
    expect(normalizeSchoolWiseSort("open")).toEqual({ sort: "open", dir: "desc" });
  });

  it("falls back to the default for a Visits-tab key or anything unknown, keeping a valid dir", () => {
    expect(normalizeSchoolWiseSort("visit_date", "asc")).toEqual({ sort: "recurring", dir: "asc" });
    expect(normalizeSchoolWiseSort("toString", "sideways")).toEqual({ sort: "recurring", dir: "desc" });
  });
});

describe("getSchoolWiseView", () => {
  const SC001 = {
    school_code: "SC001", school_name: "Test School", region: "Bhopal", af_school_category: "JNV",
    visits: "3", last_visit_date: "2026-10-20",
    recurring_count: "2", open_count: "3",
    top_recurring_id: "41", top_recurring_text: "Lab equipment missing", top_recurring_visit_count: "3",
    open_flags: "2", waiting_visits: "1",
  };
  const SC002 = {
    school_code: "SC002", school_name: "Other School", region: null, af_school_category: "GSSS",
    visits: "4", last_visit_date: "2026-08-01",
    recurring_count: "0", open_count: "1",
    top_recurring_id: null, top_recurring_text: null, top_recurring_visit_count: null,
    open_flags: "5", waiting_visits: "2",
  };
  const SC003 = {
    ...SC001, school_code: "SC003", school_name: "Third School", visits: "2",
    recurring_count: "1", open_count: "2", top_recurring_id: "77", top_recurring_text: "Fans broken",
    top_recurring_visit_count: "2", open_flags: "0", waiting_visits: "4",
  };

  function respond(rows: Record<string, unknown>[], summarisedUpTo: Date | string | null = "2026-10-20T08:30:00.000Z") {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("MAX(summarised_at)") ? [{ summarised_up_to: summarisedUpTo }] : rows
    );
  }

  it("maps each School row to numbers, with its top Recurring Concern when it has one", async () => {
    respond([SC001, SC002]);

    const view = await getSchoolWiseView(ADMIN, NO_FILTERS, { sort: "recurring", dir: "desc" });

    expect(view.rows).toEqual([
      {
        schoolCode: "SC001", schoolName: "Test School", region: "Bhopal",
        visits: 3, lastVisitDate: "2026-10-20", recurringCount: 2, openCount: 3, flagsOpen: 2,
        topRecurring: { id: 41, text: "Lab equipment missing", visitCount: 3 },
        waitingVisits: 1,
      },
      {
        schoolCode: "SC002", schoolName: "Other School", region: null,
        visits: 4, lastVisitDate: "2026-08-01", recurringCount: 0, openCount: 1, flagsOpen: 5,
        topRecurring: null,
        waitingVisits: 2,
      },
    ]);
  });

  it("totals the stats and waiting Visits over every School, with the latest summary run", async () => {
    respond([SC001, SC002, SC003]);

    const view = await getSchoolWiseView(ADMIN, NO_FILTERS, { sort: "recurring", dir: "desc" });

    expect(view.stats).toEqual({ schools: 3, visits: 9, schoolsWithRecurring: 2, openConcerns: 6 });
    expect(view.freshness).toEqual({ summarisedUpTo: new Date("2026-10-20T08:30:00.000Z"), waitingVisits: 7 });
  });

  it("recurring=1 keeps only Schools with a Recurring Concern, and the stats and waiting Visits follow", async () => {
    respond([SC001, SC002, SC003]);

    const view = await getSchoolWiseView(ADMIN, { ...NO_FILTERS, recurringOnly: true }, { sort: "recurring", dir: "desc" });

    expect(view.rows.map((row) => row.schoolCode)).toEqual(["SC001", "SC003"]);
    // SC002's 4 Visits, 1 open concern and 2 waiting Visits drop out.
    expect(view.stats).toEqual({ schools: 2, visits: 5, schoolsWithRecurring: 2, openConcerns: 5 });
    expect(view.freshness.waitingVisits).toBe(5);
  });

  it("says Visit notes were never summarised when there is no summary run", async () => {
    respond([SC001], null);

    const view = await getSchoolWiseView(ADMIN, NO_FILTERS, { sort: "recurring", dir: "desc" });

    expect(view.freshness.summarisedUpTo).toBeNull();
  });

  it("hides the flag count of a School whose flags the viewer may not see", async () => {
    respond([SC001, SC002]);

    const view = await getSchoolWiseView(SC001_PROGRAM_ADMIN, NO_FILTERS, { sort: "recurring", dir: "desc" });

    expect(view.rows.map((row) => [row.schoolCode, row.flagsOpen])).toEqual([["SC001", 2], ["SC002", null]]);
  });

  it.each(["desc", "asc"] as const)("sorting by Flags (%s) keeps the query's order but moves hidden counts last", async (dir) => {
    // The query sorted on the raw count; SC002's 5 flags are hidden from this viewer.
    respond([SC002, SC001, { ...SC003, school_code: "SC001B" }]);
    const viewer = buildVisitsActor(SC001_PROGRAM_ADMIN.email, {
      ...SC001_PROGRAM_ADMIN.permission,
      school_codes: ["SC001", "SC001B"],
    });

    const view = await getSchoolWiseView(viewer, NO_FILTERS, { sort: "flags", dir });

    expect(view.rows.map((row) => [row.schoolCode, row.flagsOpen])).toEqual([
      ["SC001", 2],
      ["SC001B", 0],
      ["SC002", null],
    ]);
  });

  it("leaves the query's order alone for any other sort", async () => {
    respond([SC002, SC001]);

    const view = await getSchoolWiseView(SC001_PROGRAM_ADMIN, NO_FILTERS, { sort: "visits", dir: "desc" });

    expect(view.rows.map((row) => row.schoolCode)).toEqual(["SC002", "SC001"]);
  });
});

describe("withRecurringSchoolsOnly", () => {
  const where = { whereSql: "v.deleted_at IS NULL AND v.status = $1", joinSql: "LEFT JOIN extra", params: ["completed"] };

  it("keeps the Visits in view and adds the Schools-with-a-Recurring-Concern rule over those same Visits", () => {
    const narrowed = withRecurringSchoolsOnly(where);
    const sql = narrowed.whereSql.replace(/\s+/g, " ");

    expect(narrowed.joinSql).toBe("LEFT JOIN extra");
    expect(narrowed.params).toEqual(["completed", 2]);
    expect(sql.startsWith("v.deleted_at IS NULL AND v.status = $1 AND v.school_code IN (")).toBe(true);
    // The inner Visits in view are the same WHERE (and joins) on their own aliases, completed only.
    expect(sql).toContain(
      "FROM lms_pm_school_visits v LEFT JOIN school s ON s.code = v.school_code LEFT JOIN extra WHERE v.deleted_at IS NULL AND v.status = $1 AND v.status = 'completed'"
    );
    // getSchoolWiseView's rule: an open Concern at the School with live mentions in 2+ distinct Visits.
    expect(sql).toContain("JOIN lms_visit_concerns c ON c.id = m.concern_id AND c.school_code = viv.school_code");
    expect(sql).toContain("WHERE c.kind = 'concern' AND c.status = 'open'");
    expect(sql).toContain("GROUP BY viv.school_code, c.id HAVING COUNT(DISTINCT viv.id) >= $2");
  });
});

describe("getSchoolConcernPage", () => {
  type Visit = { id: string; visit_date: string; status: string; pm_email: string; pm_name: string | null; summarised: boolean };
  type Mention = { id: string; kind: "concern" | "highlight"; text: string; status: "open" | "resolved" | null; visit_id: string; snippet: string };
  type Event = Record<string, unknown> & { concern_id: string };

  // The database for one School: its Visits in view (newest first, as the query orders them), every
  // mention, every concern event and the latest summary run. The mentions read answers only for the
  // Visit ids it is asked about; the events read only for the concern ids it is asked about.
  function respond({
    visits,
    mentions = [],
    events = [],
    summarisedUpTo = "2026-10-20T08:30:00.000Z",
  }: { visits: Visit[]; mentions?: Mention[]; events?: Event[]; summarisedUpTo?: string | null }) {
    mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("MAX(summarised_at)")) return [{ summarised_up_to: summarisedUpTo }];
      if (sql.includes("lms_visit_concern_events")) {
        const ids = (params[0] as number[]).map(String);
        return events.filter((event) => ids.includes(event.concern_id));
      }
      if (sql.includes("lms_visit_concern_mentions")) {
        const visitIds = (params[1] as number[]).map(String);
        return mentions.filter((mention) => visitIds.includes(mention.visit_id));
      }
      if (sql.includes("lms_pm_school_visits")) return visits;
      throw new Error(`unexpected query: ${sql}`);
    });
  }

  const visit = (id: string, visit_date: string, status = "completed", pm_name: string | null = "Ravi PM", summarised = true): Visit => ({
    id, visit_date, status, pm_email: "pm@avantifellows.org", pm_name, summarised,
  });
  const mention = (id: string, visit_id: string, kind: Mention["kind"] = "concern", status: Mention["status"] = "open", text = `Item ${id}`): Mention => ({
    id, kind, text, status: kind === "highlight" ? null : status, visit_id, snippet: `Said ${id} in ${visit_id}`,
  });

  it("counts a concern once per completed Visit that mentions it, same-day Visits separately, dates newest first", async () => {
    respond({
      visits: [visit("3", "2026-10-15"), visit("2", "2026-08-06"), visit("1", "2026-08-06")],
      mentions: [mention("41", "1"), mention("41", "3"), mention("41", "2")],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    expect(page.needsAttention).toEqual([
      {
        id: 41, kind: "concern", text: "Item 41", status: "open",
        visitCount: 3, visitDates: ["2026-10-15", "2026-08-06", "2026-08-06"],
        mentions: [
          { visitId: 3, visitDate: "2026-10-15", pmEmail: "pm@avantifellows.org", pmName: "Ravi PM", snippet: "Said 41 in 3" },
          { visitId: 2, visitDate: "2026-08-06", pmEmail: "pm@avantifellows.org", pmName: "Ravi PM", snippet: "Said 41 in 2" },
          { visitId: 1, visitDate: "2026-08-06", pmEmail: "pm@avantifellows.org", pmName: "Ravi PM", snippet: "Said 41 in 1" },
        ],
        reopened: false, history: [],
      },
    ]);
  });

  it("gives each card its mentions in view, newest first, with the Visit's PM and the snippet", async () => {
    respond({
      visits: [
        visit("4", "2026-10-20", "in_progress"),
        { ...visit("3", "2026-09-15", "completed", null), pm_email: "new.pm@avantifellows.org" },
        visit("2", "2026-08-06"),
      ],
      mentions: [
        mention("41", "2"), mention("41", "4"), mention("41", "3"),
        mention("42", "3", "highlight"),
        mention("43", "2", "concern", "resolved"),
        // A mention on a Visit out of view (deleted, another School's, filtered out) is never asked for.
        mention("41", "99"),
      ],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    // The in-progress Visit's mention isn't live; the PM's email stands in when they have no name.
    expect(page.needsAttention[0].mentions).toEqual([
      { visitId: 3, visitDate: "2026-09-15", pmEmail: "new.pm@avantifellows.org", pmName: null, snippet: "Said 41 in 3" },
      { visitId: 2, visitDate: "2026-08-06", pmEmail: "pm@avantifellows.org", pmName: "Ravi PM", snippet: "Said 41 in 2" },
    ]);
    // The mention lines and the visit count come from the same rows, so they always agree.
    expect(page.needsAttention[0].visitCount).toBe(page.needsAttention[0].mentions.length);
    expect(page.goingWell[0].mentions.map((line) => line.visitId)).toEqual([3]);
    expect(page.resolved[0].mentions.map((line) => line.snippet)).toEqual(["Said 43 in 2"]);
  });

  it("reads the snippets in the one mentions query, bound to the School and its live Visits in view", async () => {
    respond({
      visits: [visit("3", "2026-09-15"), visit("2", "2026-08-06", "in_progress"), visit("1", "2026-08-01")],
      mentions: [mention("41", "1"), mention("41", "3")],
    });

    await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    const mentionReads = mockQuery.mock.calls.filter(([sql]) => String(sql).includes("lms_visit_concern_mentions"));
    expect(mentionReads).toHaveLength(1);
    const [sql, params] = mentionReads[0] as [string, unknown[]];
    expect(sql).toContain("SELECT c.id, c.kind, c.text, c.status, m.visit_id, m.snippet");
    expect(sql).toContain("WHERE c.school_code = $1 AND m.visit_id = ANY($2::bigint[])");
    // Only the completed Visits in view (the Visits query applies every filter and drops deleted ones).
    expect(params).toEqual(["SC001", [3, 1]]);
  });

  it("ignores mentions from in-progress Visits, while still listing those Visits in Visit-wise notes", async () => {
    respond({
      visits: [visit("2", "2026-10-20", "in_progress"), visit("1", "2026-10-01")],
      mentions: [mention("41", "2"), mention("41", "1"), mention("42", "2")],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    expect(page.needsAttention.map((card) => [card.id, card.visitCount])).toEqual([[41, 1]]);
    expect(page.visitNotes.map((notes) => [notes.visitId, notes.status, notes.concerns.length])).toEqual([
      [2, "in_progress", 0],
      [1, "completed", 1],
    ]);
  });

  it("sorts cards by most Visits, then the most recent mention, then the lowest id", async () => {
    respond({
      visits: [visit("3", "2026-10-15"), visit("2", "2026-09-01"), visit("1", "2026-08-06")],
      mentions: [
        mention("50", "1"),
        mention("44", "2"),
        mention("43", "3"),
        mention("42", "3"),
        mention("60", "1"), mention("60", "2"),
      ],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    // 60: 2 Visits; 42 and 43 tie on 15 Oct (lower id first); then 44 (1 Sep); then 50 (6 Aug).
    expect(page.needsAttention.map((card) => card.id)).toEqual([60, 42, 43, 44, 50]);
  });

  it("splits open concerns, highlights and resolved concerns into their sections", async () => {
    respond({
      visits: [visit("1", "2026-10-01")],
      mentions: [mention("41", "1", "concern", "open"), mention("42", "1", "highlight"), mention("43", "1", "concern", "resolved")],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    expect(page.needsAttention.map((card) => card.id)).toEqual([41]);
    expect(page.goingWell.map((card) => [card.id, card.status])).toEqual([[42, null]]);
    expect(page.resolved.map((card) => card.id)).toEqual([43]);
  });

  it("attaches each concern's history oldest first and marks it reopened after a manual or automatic reopen", async () => {
    respond({
      visits: [visit("2", "2026-10-15"), visit("1", "2026-08-06")],
      mentions: [mention("41", "1"), mention("41", "2"), mention("42", "1"), mention("43", "1", "concern", "resolved")],
      events: [
        { concern_id: "41", kind: "resolved", body: "Kits ordered", author_email: "pm@avantifellows.org", author_name: "Ravi PM", visit_id: null, visit_date: null, at: "2026-08-10T04:30:00.000Z" },
        { concern_id: "41", kind: "auto_reopened", body: null, author_email: null, author_name: null, visit_id: "2", visit_date: "2026-10-15", at: "2026-10-16T04:30:00.000Z" },
        { concern_id: "43", kind: "resolved", body: "Fixed", author_email: "pm@avantifellows.org", author_name: null, visit_id: null, visit_date: null, at: "2026-09-01T04:30:00.000Z" },
      ],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    const [autoReopened, plain] = page.needsAttention;
    expect(autoReopened.reopened).toBe(true);
    expect(autoReopened.history).toEqual([
      { kind: "resolved", body: "Kits ordered", authorEmail: "pm@avantifellows.org", authorName: "Ravi PM", visitId: null, visitDate: null, at: new Date("2026-08-10T04:30:00.000Z") },
      { kind: "auto_reopened", body: null, authorEmail: null, authorName: null, visitId: 2, visitDate: "2026-10-15", at: new Date("2026-10-16T04:30:00.000Z") },
    ]);
    expect(plain).toMatchObject({ id: 42, reopened: false, history: [] });
    // A resolution alone isn't a reopen.
    expect(page.resolved[0]).toMatchObject({ id: 43, reopened: false });
  });

  it("lists every Visit in Visit-wise notes with its concerns and highlights, each sorted by id", async () => {
    respond({
      visits: [visit("2", "2026-10-15", "completed", null), visit("1", "2026-08-06")],
      mentions: [
        mention("45", "2", "highlight", null, "Students asking doubts"),
        mention("43", "2", "concern", "resolved", "Water cooler broken"),
        mention("41", "2", "concern", "open", "Lab equipment missing"),
      ],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    expect(page.visitNotes).toEqual([
      {
        visitId: 2, visitDate: "2026-10-15", status: "completed", summarised: true, pmEmail: "pm@avantifellows.org", pmName: null,
        concerns: [
          { id: 41, kind: "concern", text: "Lab equipment missing", status: "open" },
          { id: 43, kind: "concern", text: "Water cooler broken", status: "resolved" },
        ],
        highlights: [{ id: 45, kind: "highlight", text: "Students asking doubts", status: null }],
      },
      {
        visitId: 1, visitDate: "2026-08-06", status: "completed", summarised: true, pmEmail: "pm@avantifellows.org", pmName: "Ravi PM",
        concerns: [],
        highlights: [],
      },
    ]);
  });

  it("counts the School's completed Visits in view with no summary as waiting, like the School-wise tab, and marks each Visit-wise note", async () => {
    respond({
      visits: [
        visit("3", "2026-10-15", "completed", "Ravi PM", false),
        visit("2", "2026-10-10", "in_progress", "Ravi PM", false),
        visit("1", "2026-08-06", "completed", "Ravi PM", true),
      ],
    });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    expect(page.freshness).toEqual({ summarisedUpTo: new Date("2026-10-20T08:30:00.000Z"), waitingVisits: 1 });
    expect(page.visitNotes.map((notes) => [notes.visitId, notes.summarised])).toEqual([[3, false], [2, false], [1, true]]);
    const [visitsSql] = mockQuery.mock.calls.find(([sql]) => String(sql).includes("lms_pm_school_visits"))!;
    expect(visitsSql).toMatch(/EXISTS \(SELECT 1 FROM lms_visit_note_summaries ns WHERE ns\.visit_id = v\.id\) AS summarised/);
  });

  it("has no summary run when Visit notes were never summarised", async () => {
    respond({ visits: [visit("1", "2026-10-15", "completed", "Ravi PM", false)], summarisedUpTo: null });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    expect(page.freshness).toEqual({ summarisedUpTo: null, waitingVisits: 1 });
  });

  it("is empty but for Visit-wise notes when no Visit in view is completed", async () => {
    respond({ visits: [visit("1", "2026-10-20", "in_progress")], mentions: [mention("41", "1")] });

    const page = await getSchoolConcernPage(ADMIN, "SC001", NO_FILTERS);

    expect(page).toMatchObject({ needsAttention: [], goingWell: [], resolved: [] });
    expect(page.visitNotes.map((notes) => notes.visitId)).toEqual([1]);
  });
});

describe("findVisitSummaryConcern", () => {
  it("returns the concern and its School when the actor can see it on the Visit Summary", async () => {
    mockQuery.mockResolvedValue([{ id: "9004801", school_code: "SC001" }]);

    await expect(findVisitSummaryConcern(ADMIN, 9004801)).resolves.toEqual({ id: 9004801, schoolCode: "SC001" });
  });

  it("returns null when the lookup finds nothing", async () => {
    mockQuery.mockResolvedValue([]);

    await expect(findVisitSummaryConcern(ADMIN, 9004801)).resolves.toBeNull();
  });
});
