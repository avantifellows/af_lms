import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "./db";
import { liveBlendedMentorSql, type BlendedLearningAccess } from "./blended-learning-access";
import {
  createTeamLeadLink,
  endTeamLeadLink,
  listBlendedMentorOptions,
  listTeamLeadLinks,
} from "./blended-learning-team-leads";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);
const clientQuery = vi.fn();

const ADMIN: BlendedLearningAccess = {
  kind: "admin", role: "blended_admin", readOnly: false, actorEmail: "admin@test.local",
};
const READ_ONLY_ADMIN: BlendedLearningAccess = { ...ADMIN, readOnly: true };
const MENTOR: BlendedLearningAccess = {
  kind: "mentor", role: "blended_mentor", readOnly: false, actorEmail: "mentor@test.local",
  mentorUserId: 9001, supervisedMentorUserIds: [9002],
};

beforeEach(() => {
  mockQuery.mockReset();
  clientQuery.mockReset();
  mockWithTransaction.mockReset();
  mockWithTransaction.mockImplementation(async (fn) => fn({ query: clientQuery } as never));
});

describe("listTeamLeadLinks", () => {
  it("lists the running current-year Supervisions by team lead, with IST start dates", async () => {
    mockQuery.mockResolvedValue([
      {
        id: "4", supervisor_user_id: "9003", supervisor_name: "Synthetic Lead", supervisor_email: "lead@test.local",
        mentor_user_id: 9001, mentor_name: "Synthetic Reportee", mentor_email: "reportee@test.local",
        supervisor_is_mentor: true, mentor_is_mentor: true, started_on: "2026-11-12",
      },
    ]);

    expect(await listTeamLeadLinks(ADMIN)).toEqual([
      {
        id: 4,
        teamLead: { userId: 9003, name: "Synthetic Lead", email: "lead@test.local", isMentor: true },
        reportee: { userId: 9001, name: "Synthetic Reportee", email: "reportee@test.local", isMentor: true },
        startedOn: "2026-11-12",
      },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("supervision.academic_year = $1 AND supervision.ended_at IS NULL");
    // A future-dated link (import sheet only) grants nothing yet but holds the
    // pair's slot, so it is still listed and can be ended.
    expect(sql).not.toContain("started_at <=");
    expect(sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(params).toEqual(["2026-2027", "blended_mentor"]);
  });

  it("keeps a pair whose lead or reportee is no longer a live Mentor, flagged by the access check's own rule", async () => {
    mockQuery.mockResolvedValue([
      {
        id: 7, supervisor_user_id: 9003, supervisor_name: "Synthetic Lead", supervisor_email: null,
        mentor_user_id: 9004, mentor_name: "Synthetic Departed", mentor_email: null,
        supervisor_is_mentor: true, mentor_is_mentor: false, started_on: "2026-11-12",
      },
      {
        id: 8, supervisor_user_id: 9005, supervisor_name: "Synthetic Former Lead", supervisor_email: null,
        mentor_user_id: 9006, mentor_name: "Synthetic Also Gone", mentor_email: null,
        supervisor_is_mentor: false, mentor_is_mentor: false, started_on: "2026-11-13",
      },
    ]);

    const links = await listTeamLeadLinks(ADMIN);
    expect(links.map((link) => [link.id, link.teamLead.isMentor, link.reportee.isMentor])).toEqual([
      [7, true, false],
      [8, false, false],
    ]);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(`${liveBlendedMentorSql("supervision.supervisor_user_id", "$2")} AS supervisor_is_mentor`);
    expect(sql).toContain(`${liveBlendedMentorSql("supervision.mentor_user_id", "$2")} AS mentor_is_mentor`);
    expect(sql).toContain("live_permission.revoked_at IS NULL");
  });

  it.each([
    ["a Mentor", MENTOR],
    ["a read-only admin", READ_ONLY_ADMIN],
  ])("gives %s nothing without reading", async (_who, access) => {
    expect(await listTeamLeadLinks(access)).toEqual([]);
    expect(await listBlendedMentorOptions(access)).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("listBlendedMentorOptions", () => {
  it("lists only people with a live blended_mentor permission, Mappings alone not counting", async () => {
    mockQuery.mockResolvedValue([
      { id: "9001", name: "Synthetic Reportee", email: "reportee@test.local" },
      { id: 9003, name: "Synthetic Lead", email: null },
    ]);

    expect(await listBlendedMentorOptions(ADMIN)).toEqual([
      { userId: 9001, name: "Synthetic Reportee", email: "reportee@test.local" },
      { userId: 9003, name: "Synthetic Lead", email: null },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("permission.role = $1 AND permission.revoked_at IS NULL");
    expect(sql).not.toContain("blended_learning_mentor_mentee_mappings");
    expect(params).toEqual(["blended_mentor"]);
  });
});

// A fake blended_learning_mentor_supervisions table for the end UPDATE: it
// applies the statement's own WHERE (id, year, running) to these rows.
type SupervisionRow = { id: number; supervisor_user_id: number; mentor_user_id: number; academic_year: string; ended_at: string | null };
function givenSupervisions(table: SupervisionRow[]) {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (!sql.startsWith("UPDATE blended_learning_mentor_supervisions")) return [];
    expect(sql).toContain("WHERE id = $1 AND academic_year = $2 AND ended_at IS NULL");
    // A link that has not started yet can still be ended (at its started_at).
    expect(sql).not.toContain("started_at <=");
    const hit = table.filter((row) => row.id === params?.[0] && row.academic_year === params?.[1] && row.ended_at === null);
    for (const row of hit) row.ended_at = "2026-11-19T00:00:00Z";
    return hit.map((row) => ({ id: row.id }));
  });
}

describe("endTeamLeadLink", () => {
  it("ends only the row by its id: an old id leaves the pair's replacement running", async () => {
    // The pair was ended (row 4) and started again (row 5) before this end of row 4 ran.
    const table: SupervisionRow[] = [
      { id: 4, supervisor_user_id: 9003, mentor_user_id: 9001, academic_year: "2026-2027", ended_at: "2026-11-18T00:00:00Z" },
      { id: 5, supervisor_user_id: 9003, mentor_user_id: 9001, academic_year: "2026-2027", ended_at: null },
    ];
    givenSupervisions(table);

    expect(await endTeamLeadLink(ADMIN, 4)).toMatchObject({ ok: false, status: 404 });
    expect(table.find((row) => row.id === 5)?.ended_at).toBeNull();

    expect(await endTeamLeadLink(ADMIN, 5)).toEqual({ ok: true });
    expect(table.find((row) => row.id === 5)?.ended_at).not.toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("is a 404 for another year's running row", async () => {
    givenSupervisions([{ id: 6, supervisor_user_id: 9003, mentor_user_id: 9001, academic_year: "2025-2026", ended_at: null }]);
    expect(await endTeamLeadLink(ADMIN, 6)).toMatchObject({ status: 404 });
  });
});

describe("writes", () => {
  it("refuses a Mentor or a read-only admin without reading", async () => {
    for (const access of [MENTOR, READ_ONLY_ADMIN]) {
      expect(await createTeamLeadLink(access, { supervisorUserId: 9001, mentorUserId: 9002 })).toMatchObject({ status: 403 });
      expect(await endTeamLeadLink(access, 4)).toMatchObject({ status: 403 });
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("treats a body that isn't an object as nothing chosen", async () => {
    expect(await createTeamLeadLink(ADMIN, null)).toMatchObject({
      status: 422,
      fieldErrors: { supervisorUserId: "Choose a team lead.", mentorUserId: "Choose the mentor they lead." },
    });
  });

  it("names the team lead when only they aren't a live Blended Learning Mentor, inserting nothing", async () => {
    // Only the reportee still holds a live blended_mentor permission.
    clientQuery.mockResolvedValueOnce({ rows: [{ id: "9002" }] });
    expect(await createTeamLeadLink(ADMIN, { supervisorUserId: 4242, mentorUserId: 9002 })).toMatchObject({
      status: 422,
      error: "Choose a Blended Learning mentor.",
      fieldErrors: { supervisorUserId: "Choose a Blended Learning mentor." },
    });
    expect(clientQuery).toHaveBeenCalledTimes(1);
    const [check, params] = clientQuery.mock.calls[0];
    expect(check).toContain("permission.revoked_at IS NULL");
    expect(check).toContain("FOR SHARE OF permission");
    expect(params).toEqual(["blended_mentor", [4242, 9002]]);
  });

  it("checks both people and inserts in the same transaction", async () => {
    clientQuery.mockResolvedValueOnce({ rows: [{ id: 9003 }, { id: 9002 }] }).mockResolvedValueOnce({ rows: [{ id: 7 }] });
    expect(await createTeamLeadLink(ADMIN, { supervisorUserId: 9003, mentorUserId: 9002 })).toEqual({ ok: true });
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(clientQuery.mock.calls[1][0]).toContain("INSERT INTO blended_learning_mentor_supervisions");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
