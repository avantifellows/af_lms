import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query } from "./db";
import type { BlendedLearningAccess } from "./blended-learning-access";
import {
  createTeamLeadLink,
  endTeamLeadLink,
  listBlendedMentorOptions,
  listTeamLeadLinks,
} from "./blended-learning-team-leads";

const mockQuery = vi.mocked(query);

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
});

describe("listTeamLeadLinks", () => {
  it("lists the running current-year Supervisions by team lead, with IST start dates", async () => {
    mockQuery.mockResolvedValue([
      { id: "4", supervisor_user_id: "9003", supervisor_name: "Synthetic Lead", mentor_user_id: 9001, mentor_name: "Synthetic Reportee", started_on: "2026-11-12" },
    ]);

    expect(await listTeamLeadLinks(ADMIN)).toEqual([
      {
        id: 4,
        teamLead: { userId: 9003, name: "Synthetic Lead" },
        reportee: { userId: 9001, name: "Synthetic Reportee" },
        startedOn: "2026-11-12",
      },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("supervision.academic_year = $1 AND supervision.ended_at IS NULL");
    expect(sql).toContain("AT TIME ZONE 'Asia/Kolkata'");
    expect(params).toEqual(["2026-2027"]);
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
  it("lists Mentors with Mappings or a live blended_mentor permission, dropouts' Mappings left out", async () => {
    mockQuery.mockResolvedValue([{ id: "9001", name: "Synthetic Reportee" }, { id: 9003, name: "Synthetic Lead" }]);

    expect(await listBlendedMentorOptions(ADMIN)).toEqual([
      { userId: 9001, name: "Synthetic Reportee" },
      { userId: 9003, name: "Synthetic Lead" },
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM student dropout_student");
    expect(sql).toContain("UNION");
    expect(params).toEqual(["2026-2027", "blended_mentor", null]);
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

  it("names the team lead when only they aren't a Blended Learning Mentor", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 9002, name: "Synthetic Reportee" }]);
    expect(await createTeamLeadLink(ADMIN, { supervisorUserId: 4242, mentorUserId: 9002 })).toMatchObject({
      status: 422,
      error: "Choose a Blended Learning mentor.",
      fieldErrors: { supervisorUserId: "Choose a Blended Learning mentor." },
    });
  });
});
