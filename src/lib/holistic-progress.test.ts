import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./holistic-reconciliation", () => ({ reconcileHolisticMappings: vi.fn() }));

import { query } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import {
  DEFAULT_HOLISTIC_PROGRESS_SORT,
  formatHolisticProgressCsv,
  getHolisticCoverageSchools,
  getHolisticProgressAcademicYears,
  getHolisticProgressOptions,
  listHolisticProgress,
  type HolisticProgressRow,
} from "./holistic-progress";
import type { UserPermission } from "./permissions";

const mockQuery = vi.mocked(query);
const mockReconcile = vi.mocked(reconcileHolisticMappings);

const adminPermission: UserPermission = {
  email: "admin@example.com",
  level: 3,
  role: "admin",
  program_ids: [1, 78],
};

const databaseRow = {
  student_id: "41",
  student_name: "=SUM(A1:A2)",
  external_student_id: "AF-41",
  grade: "11",
  school_name: "School, One",
  school_code: "SCH001",
  mentor_name: "Mentor One",
  mentor_email: "mentor@example.com",
  phase_id: "70",
  phase_number: "2",
  phase_title: "Check-in",
  phase_state: "active",
  progress: "completed",
  completed_at: "2026-07-01T10:00:00.000Z",
  notes_author: "Mentor One",
  notes_author_email: "mentor@example.com",
  notes_last_edited_at: "2026-07-01T11:00:00.000Z",
  answers: [
    { position: 1, question: "+Goal?", answer: "On track" },
  ],
  total_mapped: "73",
  pending_count: "30",
  completed_count: "20",
  skipped_count: "18",
  no_active_phase_count: "5",
};

describe("Holistic progress", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
    mockReconcile.mockReset();
    mockReconcile.mockResolvedValue(0);
  });

  it("applies the actor's School scope before rows, counts, and pagination", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001", "SCH002"],
      program_ids: [1],
    };

    await listHolisticProgress({
      programId: 1,
      academicYear: "2026-2027",
      phaseId: null,
      schoolCode: null,
      grade: null,
      mentorUserId: null,
      progress: null,
      search: "",
      sort: DEFAULT_HOLISTIC_PROGRESS_SORT,
      direction: "asc",
      page: 1,
    }, scopedPermission);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("mapping_school.code = ANY($12::text[])");
    expect(params).toEqual([
      1, "2026-2027", null, null, null, null, null, "%%", 50, 0,
      "2026-2027", ["SCH001", "SCH002"],
    ]);
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      programId: 1,
      schoolCode: undefined,
      permission: scopedPermission,
    });
  });

  it("applies the actor's School scope to current-year coverage", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ eligible: "12", assigned: "9", unassigned: "3" }]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001", "SCH002"],
      program_ids: [1],
    };

    const result = await listHolisticProgress({
      programId: 1,
      academicYear: "2026-2027",
      phaseId: 70,
      schoolCode: "SCH001",
      grade: 11,
      mentorUserId: null,
      progress: "completed",
      search: "Asha",
      sort: "progress",
      direction: "desc",
      page: 2,
    }, scopedPermission);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(String(sql)).toContain("mapping_school.code = ANY($7::text[])");
    expect(params).toEqual([1, "2026-2027", "2026-2027", "SCH001", 11, "%Asha%", ["SCH001", "SCH002"]]);
    expect(result.coverage).toEqual({ eligible: 12, assigned: 9, unassigned: 3 });
  });

  it("fails coverage closed for an empty resolved School scope", async () => {
    await listHolisticProgress({
      programId: 1,
      academicYear: "2026-2027",
      phaseId: null,
      schoolCode: null,
      grade: null,
      mentorUserId: null,
      progress: null,
      search: "",
      sort: DEFAULT_HOLISTIC_PROGRESS_SORT,
      direction: "asc",
      page: 1,
    }, { email: "pa@example.com", level: 2, role: "program_admin", program_ids: [1] });

    const [sql, params] = mockQuery.mock.calls[1];
    expect(String(sql)).toContain("AND 1 = 0");
    expect(params).toEqual([1, "2026-2027", "2026-2027", null, null, "%%"]);
  });

  it.each([
    ["a past Academic Year", { academicYear: "2025-2026" }, {}],
    ["a Mentor filter", { mentorUserId: 9 }, {}],
    ["the CSV export", {}, { all: true }],
  ])("does not read coverage for %s", async (_, overrides, options) => {
    const result = await listHolisticProgress({
      programId: 1,
      academicYear: "2026-2027",
      phaseId: null,
      schoolCode: null,
      grade: null,
      mentorUserId: null,
      progress: null,
      search: "",
      sort: DEFAULT_HOLISTIC_PROGRESS_SORT,
      direction: "asc",
      page: 1,
      ...overrides,
    }, adminPermission, options);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result.coverage).toBeNull();
  });

  describe("Unassigned list", () => {
    const unassignedFilters = {
      programId: 1,
      academicYear: "2026-2027",
      phaseId: null,
      schoolCode: null,
      grade: null,
      mentorUserId: null,
      progress: "unassigned" as const,
      search: "",
      sort: DEFAULT_HOLISTIC_PROGRESS_SORT,
      direction: "asc" as const,
      page: 1,
    };
    const pmPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001", "SCH002"],
      program_ids: [1],
    };

    it("returns Unassigned rows with the Unassigned total and zero progress counts after reconciliation", async () => {
      mockQuery
        .mockResolvedValueOnce([{
          student_id: "52", student_name: null, external_student_id: "AF-52", grade: 11,
          school_name: "School One", school_code: "SCH001", active_phase_id: "70", total_unassigned: "212",
        }, {
          student_id: "53", student_name: "Ravi Kumar", external_student_id: null, grade: "12",
          school_name: "School One", school_code: "SCH001", active_phase_id: null, total_unassigned: "212",
        }] as never)
        .mockResolvedValueOnce([{ eligible: "300", assigned: "88", unassigned: "212" }]);

      const result = await listHolisticProgress(unassignedFilters, adminPermission);

      expect(mockReconcile).toHaveBeenCalledWith({
        academicYear: "2026-2027", programId: 1, schoolCode: undefined, permission: adminPermission,
      });
      expect(result).toEqual({
        rows: [
          {
            progress: "unassigned", studentId: 52, studentName: "AF-52", externalStudentId: "AF-52",
            grade: 11, schoolName: "School One", schoolCode: "SCH001", activePhaseId: 70,
          },
          {
            progress: "unassigned", studentId: 53, studentName: "Ravi Kumar", externalStudentId: null,
            grade: 12, schoolName: "School One", schoolCode: "SCH001", activePhaseId: null,
          },
        ],
        counts: { total: 212, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
        coverage: { eligible: 300, assigned: 88, unassigned: 212 },
      });
    });

    it("keeps the Unassigned total when the requested page has no rows", async () => {
      mockQuery.mockResolvedValueOnce([{ student_id: null, total_unassigned: "51" }] as never);

      const result = await listHolisticProgress({ ...unassignedFilters, page: 3 }, adminPermission);

      expect(result.rows).toEqual([]);
      expect(result.counts).toEqual({ total: 51, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 });
    });

    it("binds the PM's School codes and pages at 50 rows", async () => {
      await listHolisticProgress({
        ...unassignedFilters, phaseId: 71, schoolCode: "SCH001", grade: 11, search: "Asha", page: 2,
      }, pmPermission);

      const [sql, params] = mockQuery.mock.calls[0];
      expect(String(sql)).toContain("mapping_school.code = ANY($10::text[])");
      expect(params).toEqual([1, "2026-2027", "2026-2027", "SCH001", 11, "%Asha%", 71, 50, 50, ["SCH001", "SCH002"]]);
    });

    it("returns every row for the CSV export", async () => {
      await listHolisticProgress(unassignedFilters, adminPermission, { all: true });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][1]).toEqual([1, "2026-2027", "2026-2027", null, null, "%%", null, null, 0]);
    });

    it("fails closed for an empty resolved School scope", async () => {
      await listHolisticProgress(unassignedFilters, {
        email: "pa@example.com", level: 2, role: "program_admin", program_ids: [1],
      });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(String(sql)).toContain("AND 1 = 0");
      expect(params).toEqual([1, "2026-2027", "2026-2027", null, null, "%%", null, 50, 0]);
    });

    it.each(["pending", "completed", "skipped", "no_active_phase"] as const)(
      "keeps the assigned-Mentee query for progress %s",
      async (progress) => {
        await listHolisticProgress({ ...unassignedFilters, progress }, adminPermission);

        expect(mockQuery.mock.calls[0][1]).toEqual([
          1, "2026-2027", null, null, null, null, progress, "%%", 50, 0, "2026-2027",
        ]);
      },
    );
  });

  it("keeps an in-scope Mapping in rows, counts, and CSV after an out-of-scope School transfer", async () => {
    mockQuery.mockResolvedValueOnce([{ ...databaseRow, total_mapped: "1" }]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001"],
      program_ids: [1],
    };

    const result = await listHolisticProgress({
      programId: 1,
      academicYear: "2025-2026",
      phaseId: null,
      schoolCode: null,
      grade: null,
      mentorUserId: null,
      progress: null,
      search: "",
      sort: DEFAULT_HOLISTIC_PROGRESS_SORT,
      direction: "asc",
      page: 1,
    }, scopedPermission, { all: true });

    const sql = String(mockQuery.mock.calls[0][0]);
    const scopedMappings = sql.indexOf("WITH scoped_mappings AS");
    const mappingHistory = sql.indexOf("mapping_history AS");
    const latestMapping = sql.indexOf("SELECT DISTINCT ON (mapping.student_id)");
    expect(scopedMappings).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf("mapping_school.code = ANY($12::text[])")).toBeGreaterThan(scopedMappings);
    expect(sql.indexOf("mapping_school.code = ANY($12::text[])")).toBeLessThan(mappingHistory);
    expect(mappingHistory).toBeLessThan(latestMapping);
    expect(result.rows.map(({ studentId, schoolCode }) => ({ studentId, schoolCode }))).toEqual([
      { studentId: 41, schoolCode: "SCH001" },
    ]);
    expect(result.counts.total).toBe(1);
    const csv = formatHolisticProgressCsv("2025-2026", 1, result.rows);
    expect(csv).toContain("School, One");
    expect(csv).toContain("AF-41");
  });

  it("scopes Mapping history before choosing School and Mentor filter options after a transfer", async () => {
    mockQuery
      .mockResolvedValueOnce([{ code: "SCH001", name: "School One" }])
      .mockResolvedValueOnce([{ user_id: "9", name: "In-scope Mentor", email: "mentor@example.com" }])
      .mockResolvedValueOnce([]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001"],
      program_ids: [1],
    };

    const options = await getHolisticProgressOptions("2025-2026", 1, scopedPermission);

    for (const [sql] of mockQuery.mock.calls.slice(0, 2)) {
      const text = String(sql);
      expect(text.indexOf("WITH scoped_mappings AS")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("mapping_school.code = ANY($4::text[])")).toBeLessThan(
        text.indexOf("SELECT DISTINCT ON (mapping.student_id)"),
      );
    }
    expect(options).toMatchObject({
      schools: [{ code: "SCH001", name: "School One" }],
      mentors: [{ userId: 9, name: "In-scope Mentor" }],
    });
  });

  it("returns full-result counts while applying fixed 50-row pagination", async () => {
    mockQuery.mockResolvedValueOnce([databaseRow]);

    const result = await listHolisticProgress({
      programId: 1,
      academicYear: "2026-2027",
      phaseId: null,
      schoolCode: null,
      grade: null,
      mentorUserId: null,
      progress: null,
      search: "",
      sort: DEFAULT_HOLISTIC_PROGRESS_SORT,
      direction: "asc",
      page: 2,
    }, adminPermission);

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
      1,
      "2026-2027",
      null,
      null,
      null,
      null,
      null,
      "%%",
      50,
      50,
      "2026-2027",
    ]);
    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("MIN(mapping.started_at) OVER (PARTITION BY mapping.student_id) AS first_started_at");
    expect(sql).toContain("AND transition.occurred_at <= mapped.first_started_at");
    expect(sql).toContain("WHERE ($2 <> $11 OR (");
    expect(sql).toContain("mapping.ended_at IS NULL");
    expect(sql).toContain("FROM student live_student");
    expect(sql).toContain("COALESCE(current_roster.grade, historical_grade.grade) AS grade");
    expect(sql).toContain("HAVING COUNT(DISTINCT roster_student.grade) = 1");
    expect(sql).toContain("WHERE $2 <> $11");
    const currentRosterIndex = sql.indexOf("FROM current_roster_snapshot roster_student");
    expect(currentRosterIndex).toBeGreaterThanOrEqual(0);
    expect(currentRosterIndex).toBeLessThan(sql.indexOf("FROM enrollment_record grade_enrollment"));
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      programId: 1,
      schoolCode: undefined,
      permission: adminPermission,
    });
    expect(sql).toContain("$3::bigint IS NULL OR selected_phase.id IS NOT NULL");
    expect(sql).toContain("THEN 'active'");
    expect(sql).toContain("WHEN notes.state = 'submitted' THEN 'completed'");
    expect(sql).toContain("ELSE 'pending'");
    expect(sql).toContain("notes.state = 'submitted' THEN notes.last_edited_at");
    expect(sql).toContain("school_name ASC NULLS LAST, grade ASC NULLS LAST, student_name ASC NULLS LAST");
    expect(sql).toContain("AND notes.state = 'submitted'");
    expect(result.counts).toEqual({
      total: 73,
      pending: 30,
      completed: 20,
      skipped: 18,
      noActivePhase: 5,
    });
    expect(result.rows[0]).toMatchObject({
      studentId: 41,
      progress: "completed",
      phaseState: "active",
      notesAuthorEmail: "mentor@example.com",
    });
  });

  it("makes an orphaned draft indistinguishable from no Notes when deriving a skipped Phase", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await listHolisticProgress({
      programId: 1,
      academicYear: "2026-2027",
      phaseId: 70,
      schoolCode: null,
      grade: null,
      mentorUserId: null,
      progress: "skipped",
      search: "",
      sort: DEFAULT_HOLISTIC_PROGRESS_SORT,
      direction: "asc",
      page: 1,
    }, adminPermission);

    const sql = String(mockQuery.mock.calls[0][0]);
    expect(sql).toContain("AND notes.state = 'submitted'");
    expect(sql).not.toContain("WHEN notes.state = 'draft'");
    expect(sql).toContain("WHEN base.initial_active_position IS NOT NULL AND base.phase_number < base.initial_active_position THEN 'skipped'");
  });

  it("exports only approved fields and neutralizes formula-leading names and authored text", () => {
    const row: HolisticProgressRow = {
      studentId: 41,
      studentName: "=SUM(A1:A2)",
      externalStudentId: "AF-41",
      grade: 11,
      schoolName: "School, One",
      schoolCode: "SCH001",
      mentorName: "Mentor One",
      mentorEmail: "mentor@example.com",
      phaseId: 70,
      phaseNumber: 2,
      phaseTitle: "Check-in",
      phaseState: "active",
      progress: "completed",
      completedAt: "2026-07-01T10:00:00.000Z",
      notesAuthor: "Mentor One",
      notesAuthorEmail: "mentor@example.com",
      notesLastEditedAt: "2026-07-01T11:00:00.000Z",
      answers: [
        { position: 1, question: "+Goal?", answer: "On track" },
        { position: 2, question: "What changed?", answer: "A comma, and a \"quote\"" },
        { position: 3, question: "Next step?", answer: "Line one\nLine two" },
        { position: 4, question: "Support?", answer: "@external" },
        { position: 5, question: "Anything else?", answer: "Keep going" },
      ],
    };

    const csv = formatHolisticProgressCsv("2026-2027", 1, [row]);

    expect(csv).toContain("\"'=SUM(A1:A2)\"");
    expect(csv).toContain("\"School, One\"");
    expect(csv).toContain("\"'+Goal?\"");
    expect(csv).toContain("Academic Year,Program ID,Program Name");
    expect(csv).toContain("2026-2027,1,JNV CoE");
    expect(csv).toContain("active,completed");
    expect(csv).toContain("Notes Author Name,Notes Author Email,Notes Last Edited At");
    expect(csv).toContain("Mentor One,mentor@example.com,2026-07-01T11:00:00.000Z");
    expect(csv).toContain("\"A comma, and a \"\"quote\"\"\"");
    expect(csv).toContain("\"Line one\nLine two\"");
    expect(csv).toContain("\"'@external\"");
    expect(csv).toContain("Question 5,Answer 5");
    expect(csv).toContain("Anything else?,Keep going");
    expect(csv).not.toContain("studentId");
    expect(csv).not.toContain("Student Profile");
  });

  describe("Unassigned CSV rows", () => {
    const unassignedRow: HolisticProgressRow = {
      progress: "unassigned",
      studentId: 52,
      studentName: "Asha Rao",
      externalStudentId: "AF-52",
      grade: 11,
      schoolName: "School One",
      schoolCode: "SCH001",
      activePhaseId: 70,
    };

    it("fills Student and School cells, sets Progress to unassigned, and leaves every other cell blank", () => {
      expect(formatHolisticProgressCsv("2026-2027", 1, [unassignedRow]).split("\r\n")).toEqual([
        "Academic Year,Program ID,Program Name,School,UDISE Code,Student Name,Student External ID," +
          "Grade,Mentor Name,Mentor Email,Phase,Phase Title,Availability,Progress,Completed At," +
          "Notes Author Name,Notes Author Email,Notes Last Edited At",
        "2026-2027,1,JNV CoE,School One,SCH001,Asha Rao,AF-52,11,,,,,,unassigned,,,,",
      ]);
    });

    it("stops Question/Answer columns at the highest answer position in a mixed export", () => {
      const assignedRow: HolisticProgressRow = {
        studentId: 41, studentName: "Student One", externalStudentId: "AF-41", grade: 11,
        schoolName: "School One", schoolCode: "SCH001", mentorName: "Mentor One", mentorEmail: "mentor@example.com",
        phaseId: 70, phaseNumber: 2, phaseTitle: "Check-in", phaseState: "active", progress: "completed",
        completedAt: "2026-07-01T10:00:00.000Z", notesAuthor: "Mentor One", notesAuthorEmail: "mentor@example.com",
        notesLastEditedAt: "2026-07-01T11:00:00.000Z",
        answers: [
          { position: 1, question: "Goal?", answer: "On track" },
          { position: 2, question: "Next?", answer: "Practice" },
        ],
      };

      const [header, assigned, unassigned] = formatHolisticProgressCsv("2026-2027", 1, [assignedRow, unassignedRow])
        .split("\r\n");

      expect(header).toContain("Completed At,Question 1,Answer 1,Question 2,Answer 2,Notes Author Name");
      expect(header).not.toContain("Question 3");
      expect(assigned).toBe(
        "2026-2027,1,JNV CoE,School One,SCH001,Student One,AF-41,11,Mentor One,mentor@example.com," +
        "Phase 2,Check-in,active,completed,2026-07-01T10:00:00.000Z,Goal?,On track,Next?,Practice," +
        "Mentor One,mentor@example.com,2026-07-01T11:00:00.000Z",
      );
      expect(unassigned).toBe("2026-2027,1,JNV CoE,School One,SCH001,Asha Rao,AF-52,11,,,,,,unassigned,,,,,,,,");
    });

    it("neutralizes a formula-leading Unassigned Student name", () => {
      const csv = formatHolisticProgressCsv("2026-2027", 1, [{ ...unassignedRow, studentName: "=HYPERLINK(\"x\")" }]);

      expect(csv.split("\r\n")[1]).toBe(
        "2026-2027,1,JNV CoE,School One,SCH001,\"'=HYPERLINK(\"\"x\"\")\",AF-52,11,,,,,,unassigned,,,,",
      );
    });
  });

  it("uses only each Student's latest yearly Mapping for School and Mentor options", async () => {
    mockQuery
      .mockResolvedValueOnce([{ code: "SCH001", name: "School One" }])
      .mockResolvedValueOnce([{ user_id: "9", name: "Current Mentor", email: "current@example.com" }])
      .mockResolvedValueOnce([{ id: "70", position: 2, title: "Check-in", grade: "11", state: "open" }]);

    const options = await getHolisticProgressOptions("2025-2026", 1, adminPermission);

    expect(options).toMatchObject({
      schools: [{ code: "SCH001", name: "School One" }],
      mentors: [{ userId: 9, name: "Current Mentor" }],
    });
    for (const call of mockQuery.mock.calls.slice(0, 2)) {
      const sql = String(call[0]);
      expect(sql).toContain("SELECT DISTINCT ON (mapping.student_id) mapping.*");
      expect(sql).toContain("FROM latest_mapping mapping");
      expect(call[1]).toEqual([1, "2025-2026", "2026-2027"]);
    }
  });

  it("lists every active in-scope Program School for Assignment Coverage without requiring a Mapping", async () => {
    mockQuery.mockResolvedValueOnce([
      { code: "SCH001", name: "School One" },
      { code: "SCH002", name: "School Without Mappings" },
    ]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001", "SCH002"],
      program_ids: [78],
    };

    await expect(getHolisticCoverageSchools(78, scopedPermission)).resolves.toEqual([
      { code: "SCH001", name: "School One" },
      { code: "SCH002", name: "School Without Mappings" },
    ]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("JOIN centres centre");
    expect(String(sql)).toContain("centre.program_id = $1");
    expect(String(sql)).toContain("centre.is_active IS TRUE");
    expect(String(sql)).toContain("school.code = ANY($2::text[])");
    expect(String(sql)).not.toContain("holistic_mentorship_mentor_mentee_mappings");
    expect(params).toEqual([78, ["SCH001", "SCH002"]]);
  });

  it("limits School and Mentor filter options to the actor's School scope", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const scopedPermission: UserPermission = {
      email: "pa@example.com",
      level: 2,
      role: "program_admin",
      regions: ["North"],
      program_ids: [1],
    };

    await getHolisticProgressOptions("2026-2027", 1, scopedPermission);

    for (const [sql, params] of mockQuery.mock.calls.slice(0, 2)) {
      expect(String(sql)).toContain("COALESCE(mapping_school.region, '') = ANY($4::text[])");
      expect(params).toEqual([1, "2026-2027", "2026-2027", ["North"]]);
    }
  });

  it("returns the current Academic Year first, followed by available prior years", async () => {
    mockQuery.mockResolvedValueOnce([
      { academic_year: "2026-2027" },
      { academic_year: "2025-2026" },
      { academic_year: "2023-2024" },
    ]);

    await expect(getHolisticProgressAcademicYears(1, adminPermission)).resolves.toEqual([
      "2026-2027",
      "2025-2026",
      "2023-2024",
    ]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("FROM holistic_mentorship_phase_plans plan");
    expect(String(sql)).toContain("FROM holistic_mentorship_mentor_mentee_mappings mapping");
    expect(String(sql)).toContain("ORDER BY CASE WHEN available.academic_year = $2 THEN 0 ELSE 1 END");
    expect(params).toEqual([1, "2026-2027"]);
  });

  it("derives prior Academic Years only from Mapping history in scope", async () => {
    mockQuery.mockResolvedValueOnce([{ academic_year: "2026-2027" }]);
    const scopedPermission: UserPermission = {
      email: "pm@example.com",
      level: 1,
      role: "program_manager",
      school_codes: ["SCH001"],
      program_ids: [1],
    };

    await getHolisticProgressAcademicYears(1, scopedPermission);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("JOIN school ON school.id = mapping.school_id");
    expect(String(sql)).toContain("school.code = ANY($3::text[])");
    expect(params).toEqual([1, "2026-2027", ["SCH001"]]);
  });

  it("keeps full counts when the requested page has no rows", async () => {
    mockQuery.mockResolvedValueOnce([{
      student_id: null, total_mapped: "51", pending_count: "51", completed_count: "0",
      skipped_count: "0", no_active_phase_count: "0",
    } as never]);

    const result = await listHolisticProgress({
      programId: 1,
      academicYear: "2026-2027", phaseId: null, schoolCode: null, grade: null,
      mentorUserId: null, progress: null, search: "", sort: "student_name", direction: "asc", page: 3,
    }, adminPermission);

    expect(result.rows).toEqual([]);
    expect(result.counts.total).toBe(51);
  });
});
