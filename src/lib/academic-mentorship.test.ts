import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { query } from "./db";
import {
  createAcademicMentorshipMapping,
  endAcademicMentorshipMapping,
  listAcademicMentorshipMenteeOptions,
  listAcademicMentorshipMentorOptions,
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

describe("listAcademicMentorshipMentorOptions", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns searchable completed Staff Management Teachers with effective access to the selected School", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        user_id: 101,
        name: "Anita Mentor",
        email: "anita@avantifellows.org",
      },
    ]);

    const mentors = await listAcademicMentorshipMentorOptions({
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      search: "anita",
    });

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("up.role = 'teacher'");
    expect(sql).toContain("up.revoked_at IS NULL");
    expect(sql).toContain("t.is_af_teacher = true");
    expect(sql).toContain("t.exit_date IS NULL");
    expect(sql).toContain("cp.deleted_at IS NULL");
    expect(sql).toContain("ILIKE $4");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "SCH001",
      "North",
      20,
      "%anita%",
    ]);
    expect(mentors).toEqual([
      {
        userId: 101,
        name: "Anita Mentor",
        email: "anita@avantifellows.org",
      },
    ]);
  });
});

describe("listAcademicMentorshipMenteeOptions", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns searchable active unassigned Students from the selected School roster", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        student_pk_id: 201,
        name: "Meena Student",
        student_id: "STU001",
        grade: 11,
        program_id: 64,
      },
    ]);

    const mentees = await listAcademicMentorshipMenteeOptions({
      schoolId: 20,
      academicYear: "2026-2027",
      search: "mee",
    });

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("g.type = 'school'");
    expect(sql).toContain("er_grade.academic_year = $2");
    expect(sql).toContain("status IS DISTINCT FROM 'dropout'");
    expect(sql).toContain("active_mapping.id IS NULL");
    expect(sql).toContain("st.student_id ILIKE $3");
    expect(mockQuery.mock.calls[0][1]).toEqual([20, "2026-2027", "%mee%"]);
    expect(mentees).toEqual([
      {
        studentPkId: 201,
        name: "Meena Student",
        studentId: "STU001",
        grade: 11,
        programId: 64,
      },
    ]);
  });
});

describe("createAcademicMentorshipMapping", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("creates an active Mapping with actor audit and the Mentee roster Program", async () => {
    mockQuery
      .mockResolvedValueOnce([{ user_id: 101 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ student_pk_id: 201, program_id: 64 }])
      .mockResolvedValueOnce([{ id: 7 }]);

    const result = await createAcademicMentorshipMapping({
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      mentorUserId: 101,
      studentPkId: 201,
      assignedByUserId: 501,
    });

    expect(result).toEqual({ ok: true, mappingId: 7 });
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO academic_mentorship_mentor_mentee_mappings")
    );
    expect(String(insertCall?.[0])).toContain("assigned_at");
    expect(String(insertCall?.[0])).toContain("assigned_by_user_id");
    expect(insertCall?.[1]).toEqual([
      20,
      "2026-2027",
      101,
      201,
      64,
      501,
    ]);
  });
});

describe("endAcademicMentorshipMapping", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("ends only an active Mapping and records the actor", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 7 }]);

    const result = await endAcademicMentorshipMapping({
      schoolId: 20,
      academicYear: "2026-2027",
      mappingId: 7,
      endedByUserId: 501,
    });

    expect(result).toEqual({ ok: true, mappingId: 7 });
    expect(String(mockQuery.mock.calls[0][0])).toContain("ended_at = now()");
    expect(String(mockQuery.mock.calls[0][0])).toContain("ended_by_user_id = $4");
    expect(String(mockQuery.mock.calls[0][0])).toContain("ended_at IS NULL");
    expect(mockQuery.mock.calls[0][1]).toEqual([7, 20, "2026-2027", 501]);
  });
});
