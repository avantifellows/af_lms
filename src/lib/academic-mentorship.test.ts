import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { query } from "./db";
import {
  listAcademicMentorshipMappings,
  requireAcademicMentorshipAccess,
} from "./academic-mentorship";
import { PROGRAM_IDS } from "./constants";

const mockQuery = vi.mocked(query);

describe("requireAcademicMentorshipAccess", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("denies passcode users before database access", async () => {
    const result = await requireAcademicMentorshipAccess(
      { user: { email: "70705@passcode.local" }, isPasscodeUser: true },
      "view"
    );

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows NVS-only program_admin edit access through the Academic Mentorship wildcard allowlist", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        email: "pa@avantifellows.org",
        level: 3,
        role: "program_admin",
        school_codes: null,
        regions: null,
        program_ids: [PROGRAM_IDS.NVS],
        read_only: false,
        user_id: null,
      },
    ]);

    const result = await requireAcademicMentorshipAccess(
      { user: { email: "pa@avantifellows.org" } },
      "edit"
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.canEdit).toBe(true);
  });

  it("downgrades read_only program_admin to view-only", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        email: "readonly@avantifellows.org",
        level: 3,
        role: "program_admin",
        school_codes: null,
        regions: null,
        program_ids: [PROGRAM_IDS.COE],
        read_only: true,
        user_id: null,
      },
    ]);

    const result = await requireAcademicMentorshipAccess(
      { user: { email: "readonly@avantifellows.org" } },
      "view"
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.canEdit).toBe(false);
  });

  it("denies access to a selected School outside the resolved scope", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          email: "pa@avantifellows.org",
          level: 1,
          role: "program_admin",
          school_codes: ["SCH001"],
          regions: null,
          program_ids: [PROGRAM_IDS.COE],
          read_only: false,
          user_id: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH002", name: "Other School", region: "North" },
      ]);

    const result = await requireAcademicMentorshipAccess(
      { user: { email: "pa@avantifellows.org" } },
      "view",
      { schoolCode: "SCH002" }
    );

    expect(result).toEqual({ ok: false, status: 403, error: "Forbidden" });
    expect(mockQuery.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.stringContaining("academic_mentorship_mentor_mentee_mappings"),
        ]),
      ])
    );
  });
});

describe("listAcademicMentorshipMappings", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("groups active mappings by Academic Mentor by default", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 1,
        mentor_user_id: 101,
        mentor_name: "Anita Mentor",
        mentor_email: "anita@avantifellows.org",
        student_pk_id: 201,
        mentee_name: "Meena Student",
        mentee_student_id: "STU001",
        mentee_grade: 11,
        assigned_date: "2026-07-01",
        ended_date: null,
      },
      {
        id: 2,
        mentor_user_id: 101,
        mentor_name: "Anita Mentor",
        mentor_email: "anita@avantifellows.org",
        student_pk_id: 202,
        mentee_name: "Ravi Student",
        mentee_student_id: "STU002",
        mentee_grade: 12,
        assigned_date: "2026-07-02",
        ended_date: null,
      },
    ]);

    const groups = await listAcademicMentorshipMappings({
      schoolId: 20,
      academicYear: "2026-2027",
      includeHistory: false,
    });

    expect(String(mockQuery.mock.calls[0][0])).toContain("m.ended_at IS NULL");
    expect(groups).toEqual([
      {
        mentor: {
          userId: 101,
          name: "Anita Mentor",
          email: "anita@avantifellows.org",
        },
        menteeCount: 2,
        mappings: [
          {
            id: 1,
            mentee: {
              studentPkId: 201,
              name: "Meena Student",
              studentId: "STU001",
              grade: 11,
            },
            assignedDate: "2026-07-01",
            endedDate: null,
            status: "active",
          },
          {
            id: 2,
            mentee: {
              studentPkId: 202,
              name: "Ravi Student",
              studentId: "STU002",
              grade: 12,
            },
            assignedDate: "2026-07-02",
            endedDate: null,
            status: "active",
          },
        ],
      },
    ]);
  });
});
