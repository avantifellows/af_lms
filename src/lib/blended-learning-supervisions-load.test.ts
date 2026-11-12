import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "./db";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import {
  formatSupervisionsLoadReport,
  parseSupervisionPair,
  runSupervisionsLoad,
} from "./blended-learning-supervisions-load";

const mockQuery = vi.mocked(query);
const clientQuery = vi.fn();

// Fixture tables: live user_permission rows (role and resolved user id), the
// running Supervisions and each Mentor's active Mapping count.
const PEOPLE: Record<string, { role: string; user_id: number | null }> = {
  "lead@test.local": { role: "blended_mentor", user_id: 9001 },
  "reportee@test.local": { role: "blended_mentor", user_id: 9002 },
  "other@test.local": { role: "blended_mentor", user_id: 9003 },
  "nouser@test.local": { role: "blended_mentor", user_id: null },
  "bl.admin@test.local": { role: "blended_admin", user_id: 11 },
};
let running: [number, number][];
const MENTEES: Record<number, number> = { 9002: 42, 9003: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  running = [];
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_permission")) {
      const row = PEOPLE[String(params?.[0]).toLowerCase()];
      return row ? [row] : [];
    }
    if (sql.includes("FROM blended_learning_mentor_supervisions")) {
      const [supervisor, mentor, year] = params ?? [];
      const match = running.some(([s, m]) => s === supervisor && m === mentor) && year === CURRENT_ACADEMIC_YEAR;
      return match ? [{ id: "1" }] : [];
    }
    if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
      return [{ count: String(MENTEES[Number(params?.[0])] ?? 0) }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  clientQuery.mockResolvedValue({ rows: [{ id: "7" }] });
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: clientQuery } as never));
});

const PAIR = { supervisorEmail: "lead@test.local", mentorEmail: "reportee@test.local" };
const BY = "ops@test.local";

describe("parseSupervisionPair", () => {
  it("reads <supervisor email>:<mentor email>", () => {
    expect(parseSupervisionPair(" lead@test.local : reportee@test.local ")).toEqual(PAIR);
  });

  it.each(["lead@test.local", "lead@test.local:", "lead:reportee@test.local", "a@x.y:b@x.y:c@x.y"])(
    "refuses %s",
    (value) => {
      expect(() => parseSupervisionPair(value)).toThrow("--pair must be");
    }
  );
});

describe("runSupervisionsLoad", () => {
  it("plans a new Supervision on a dry run and writes nothing", async () => {
    const report = await runSupervisionsLoad({ pairs: [PAIR], mode: "dry-run", action: "start", by: BY });

    expect(report.pairs).toEqual([
      { ...PAIR, outcome: "insert", supervisorUserId: 9001, mentorUserId: 9002, menteeCount: 42 },
    ]);
    expect(report).toMatchObject({ written: 0, blocked: false, academicYear: CURRENT_ACADEMIC_YEAR });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("inserts on apply, in one transaction, with the operator and reason as audit", async () => {
    const report = await runSupervisionsLoad({
      pairs: [PAIR, { supervisorEmail: "other@test.local", mentorEmail: "reportee@test.local" }],
      mode: "apply",
      action: "start",
      by: BY,
      reason: "  Team lead  ",
    });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(report.written).toBe(2);
    expect(clientQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = clientQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO blended_learning_mentor_supervisions");
    expect(sql).toContain("ON CONFLICT (supervisor_user_id, mentor_user_id, academic_year) WHERE ended_at IS NULL DO NOTHING");
    expect(params).toEqual([9001, 9002, CURRENT_ACADEMIC_YEAR, BY, "af_lms_script", "Team lead"]);
  });

  it("leaves a running Supervision unchanged, so a re-run writes nothing", async () => {
    running = [[9001, 9002]];
    const report = await runSupervisionsLoad({ pairs: [PAIR], mode: "apply", action: "start", by: BY });

    expect(report.pairs[0].outcome).toBe("unchanged");
    expect(report.written).toBe(0);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["a supervisor who is not a live Mentor", { supervisorEmail: "bl.admin@test.local", mentorEmail: "reportee@test.local" }, "supervisor_not_a_mentor"],
    ["an unknown supervisor", { supervisorEmail: "nobody@test.local", mentorEmail: "reportee@test.local" }, "supervisor_not_a_mentor"],
    ["a Mentor who is not a live Mentor", { supervisorEmail: "lead@test.local", mentorEmail: "bl.admin@test.local" }, "mentor_not_a_mentor"],
    ["a Mentor with no user id", { supervisorEmail: "lead@test.local", mentorEmail: "nouser@test.local" }, "mentor_no_user"],
    ["the same person twice", { supervisorEmail: "lead@test.local", mentorEmail: "LEAD@test.local" }, "same_person"],
  ])("blocks %s, and an apply then writes no pair at all", async (_case, blockedPair, outcome) => {
    const report = await runSupervisionsLoad({ pairs: [PAIR, blockedPair], mode: "apply", action: "start", by: BY });

    expect(report.pairs.map((pair) => pair.outcome)).toEqual(["insert", outcome]);
    expect(report).toMatchObject({ blocked: true, written: 0 });
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("ends a running Supervision, and reports one that isn't running", async () => {
    running = [[9001, 9002]];
    const report = await runSupervisionsLoad({
      pairs: [PAIR, { supervisorEmail: "lead@test.local", mentorEmail: "other@test.local" }],
      mode: "apply",
      action: "end",
      by: BY,
    });

    expect(report.pairs.map((pair) => pair.outcome)).toEqual(["end", "not_running"]);
    expect(clientQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = clientQuery.mock.calls[0];
    expect(sql).toContain("UPDATE blended_learning_mentor_supervisions");
    expect(params).toEqual([9001, 9002, CURRENT_ACADEMIC_YEAR, BY, "af_lms_script", "supervision_ended", null]);
  });

  it("needs a pair and the operator's email", async () => {
    await expect(runSupervisionsLoad({ pairs: [], mode: "dry-run", action: "start", by: BY })).rejects.toThrow("--pair");
    await expect(runSupervisionsLoad({ pairs: [PAIR], mode: "dry-run", action: "start", by: "" })).rejects.toThrow("--by");
  });
});

describe("formatSupervisionsLoadReport", () => {
  it("says what each pair would do and that a dry run wrote nothing", async () => {
    const report = await runSupervisionsLoad({ pairs: [PAIR], mode: "dry-run", action: "start", by: BY });

    expect(formatSupervisionsLoadReport(report)).toEqual([
      `Blended Learning Supervisions, ${CURRENT_ACADEMIC_YEAR}: start (dry-run)`,
      "  lead@test.local -> reportee@test.local: insert (user 9001 -> 9002; mentor has 42 active mentees)",
      "Dry run: nothing was written. Re-run with --apply to write.",
    ]);
  });
});
