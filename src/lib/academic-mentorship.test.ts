import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

import { query, withTransaction } from "./db";
import {
  createAcademicMentorshipMapping,
  importAcademicMentorshipMappingsFromCsv,
  endAcademicMentorshipMapping,
  listAcademicMentorshipMenteeOptions,
  listAcademicMentorshipMentorOptions,
  listAcademicMentorshipMappings,
  listAcademicMentorshipTeacherMentees,
  reassignAcademicMentorshipMapping,
  requireAcademicMentorshipAccess,
} from "./academic-mentorship";
import { PROGRAM_IDS } from "./constants";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);

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
        program_id: PROGRAM_IDS.NVS,
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
        program_id: PROGRAM_IDS.NVS,
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
              programId: PROGRAM_IDS.NVS,
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
              programId: PROGRAM_IDS.NVS,
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

describe("listAcademicMentorshipTeacherMentees", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("returns only the signed-in Teacher's active current-year Mentees sorted for the School page", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        student_pk_id: 202,
        mentee_name: "Anaya Student",
        mentee_student_id: "STU002",
        mentee_grade: 10,
        assigned_date: "2026-07-02",
      },
    ]);

    const mentees = await listAcademicMentorshipTeacherMentees({
      schoolId: 20,
      academicYear: "2026-2027",
      mentorUserId: 101,
    });

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("m.academic_year = $2");
    expect(sql).toContain("m.mentor_user_id = $3");
    expect(sql).not.toContain("LOWER(mentor.email)");
    expect(sql).toContain("m.ended_at IS NULL");
    expect(sql).toContain("ORDER BY gr.number ASC");
    expect(mockQuery.mock.calls[0][1]).toEqual([20, "2026-2027", 101]);
    expect(mentees).toEqual([
      {
        studentPkId: 202,
        name: "Anaya Student",
        studentId: "STU002",
        grade: 10,
        assignedDate: "2026-07-02",
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
    expect(sql).toContain("er.academic_year = $2");
    expect(sql).not.toContain("er_grade.is_current = true");
    expect(sql).toContain("status IS DISTINCT FROM 'dropout'");
    expect(sql).toContain("active_mapping.id IS NULL");
    expect(sql).toContain("st.student_id ILIKE $3");
    expect(mockQuery.mock.calls[0][1]).toEqual([20, "2026-2027", "%mee%", null]);
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

describe("reassignAcademicMentorshipMapping", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it("ends the old active Mapping and inserts the replacement Mapping in one transaction", async () => {
    const txQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ student_id: 201, mentor_user_id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ student_pk_id: 201, program_id: 64 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] });
    mockQuery.mockResolvedValueOnce([{ user_id: 102 }]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const result = await reassignAcademicMentorshipMapping({
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      mappingId: 7,
      replacementMentorUserId: 102,
      assignedByUserId: 501,
    });

    expect(result).toEqual({ ok: true, mappingId: 9 });
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(String(txQuery.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(txQuery.mock.calls[0][1]).toEqual([7, 20, "2026-2027"]);
    expect(String(txQuery.mock.calls[2][0])).toContain("ended_at = now()");
    expect(txQuery.mock.calls[2][1]).toEqual([7, 20, "2026-2027", 501]);
    expect(String(txQuery.mock.calls[3][0])).toContain(
      "INSERT INTO academic_mentorship_mentor_mentee_mappings"
    );
    expect(txQuery.mock.calls[3][1]).toEqual([
      20,
      "2026-2027",
      102,
      201,
      64,
      501,
    ]);
  });

  it("maps replacement insert races to a conflict inside the transaction", async () => {
    const duplicateError = new Error("duplicate key value violates unique constraint");
    Object.assign(duplicateError, { code: "23505" });
    const txQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ student_id: 201, mentor_user_id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ student_pk_id: 201, program_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockRejectedValueOnce(duplicateError);
    mockQuery.mockResolvedValueOnce([{ user_id: 102 }]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const result = await reassignAcademicMentorshipMapping({
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      mappingId: 7,
      replacementMentorUserId: 102,
      assignedByUserId: 501,
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Student already has a mentor mapped",
    });
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(String(txQuery.mock.calls[2][0])).toContain("ended_at = now()");
    expect(String(txQuery.mock.calls[3][0])).toContain(
      "INSERT INTO academic_mentorship_mentor_mentee_mappings"
    );
  });
});

describe("importAcademicMentorshipMappingsFromCsv", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it("returns a file-level error when required CSV headers are missing", async () => {
    const result = await importAcademicMentorshipMappingsFromCsv({
      csvText: "mentor_email,name\nanita@avantifellows.org,Meena\n",
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      assignedByUserId: 501,
    });

    expect(result).toEqual({
      ok: false,
      type: "file",
      error: "CSV must include mentor_email and student_id headers",
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns row-level errors with duplicate spreadsheet row numbers and preserves extra CSV columns", async () => {
    const result = await importAcademicMentorshipMappingsFromCsv({
      csvText: [
        "mentor_email,student_id,notes",
        "anita@avantifellows.org,,missing student",
        "anita@avantifellows.org,STU001,first duplicate",
        "meena@avantifellows.org, STU001 ,second duplicate",
        ",STU002,missing mentor",
      ].join("\n"),
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      assignedByUserId: 501,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      type: "rows",
      errors: [
        { rowNumber: 2, error: "student_id is required" },
        { rowNumber: 3, error: "Duplicate student_id STU001 in rows 3, 4" },
        { rowNumber: 4, error: "Duplicate student_id STU001 in rows 3, 4" },
        { rowNumber: 5, error: "mentor_email is required" },
      ],
    });
    if (!result.ok && result.type === "rows") {
      expect(result.errorCsv).toContain("mentor_email,student_id,notes,error_reason");
      expect(result.errorCsv).toContain("anita@avantifellows.org,,missing student,student_id is required");
      expect(result.errorCsv).toContain('meena@avantifellows.org, STU001 ,second duplicate,"Duplicate student_id STU001 in rows 3, 4"');
    }
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("trims lookup values and inserts every valid row in one transaction", async () => {
    const txQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: 31 }, { id: 32 }] });
    mockQuery
      .mockResolvedValueOnce([
        { email: "anita@avantifellows.org", user_id: 101 },
        { email: "meena@avantifellows.org", user_id: 102 },
      ])
      .mockResolvedValueOnce([
        { student_id: "STU001", student_pk_id: 201, program_id: 64 },
        { student_id: "STU002", student_pk_id: 202, program_id: null },
      ]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const result = await importAcademicMentorshipMappingsFromCsv({
      csvText: [
        "mentor_email,student_id,notes",
        " ANITA@AVANTIFELLOWS.ORG , STU001 ,kept",
        ",,",
        "meena@avantifellows.org,STU002,also kept",
      ].join("\n"),
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      assignedByUserId: 501,
    });

    expect(result).toEqual({ ok: true, insertedCount: 2 });
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "SCH001",
      "North",
      20,
      ["anita@avantifellows.org", "meena@avantifellows.org"],
    ]);
    expect(mockQuery.mock.calls[1][1]).toEqual([
      20,
      "2026-2027",
      ["STU001", "STU002"],
    ]);
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(String(txQuery.mock.calls[0][0])).toContain(
      "INSERT INTO academic_mentorship_mentor_mentee_mappings"
    );
    expect(txQuery.mock.calls[0][1]).toEqual([
      20,
      "2026-2027",
      101,
      201,
      64,
      501,
      20,
      "2026-2027",
      102,
      202,
      null,
      501,
    ]);
  });

  it("caps uploads at 2,000 data rows before database access", async () => {
    const csvText = [
      "mentor_email,student_id",
      ...Array.from(
        { length: 2001 },
        (_, index) => `mentor${index}@avantifellows.org,STU${index}`
      ),
    ].join("\n");

    const result = await importAcademicMentorshipMappingsFromCsv({
      csvText,
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      assignedByUserId: 501,
    });

    expect(result).toEqual({
      ok: false,
      type: "file",
      error: "CSV upload is capped at 2,000 data rows",
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns row-level eligibility and active Mapping errors without writing", async () => {
    mockQuery
      .mockResolvedValueOnce([{ email: "anita@avantifellows.org", user_id: 101 }])
      .mockResolvedValueOnce([
        {
          student_id: "STU001",
          student_pk_id: 201,
          program_id: 64,
          active_mapping_id: 77,
        },
      ]);

    const result = await importAcademicMentorshipMappingsFromCsv({
      csvText: [
        "mentor_email,student_id",
        "unknown@avantifellows.org,STU001",
        "anita@avantifellows.org,STU999",
      ].join("\n"),
      schoolId: 20,
      schoolCode: "SCH001",
      schoolRegion: "North",
      academicYear: "2026-2027",
      assignedByUserId: 501,
    });

    expect(result).toMatchObject({
      ok: false,
      type: "rows",
      errors: [
        {
          rowNumber: 2,
          error: "mentor_email is not an eligible Academic Mentor for this School",
        },
        { rowNumber: 2, error: "Student already has a mentor mapped" },
        {
          rowNumber: 3,
          error: "student_id is not an eligible Mentee for this School and academic year",
        },
      ],
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
