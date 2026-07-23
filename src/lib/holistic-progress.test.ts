import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));
vi.mock("./holistic-reconciliation", () => ({ reconcileHolisticMappings: vi.fn() }));

import { query } from "./db";
import { reconcileHolisticMappings } from "./holistic-reconciliation";
import {
  DEFAULT_HOLISTIC_PROGRESS_SORT,
  formatHolisticProgressCsv,
  getHolisticProgressAcademicYears,
  getHolisticProgressOptions,
  listHolisticProgress,
  type HolisticProgressRow,
} from "./holistic-progress";

const mockQuery = vi.mocked(query);
const mockReconcile = vi.mocked(reconcileHolisticMappings);

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
    mockReconcile.mockReset();
    mockReconcile.mockResolvedValue(0);
  });

  it("returns full-result counts while applying fixed 50-row pagination", async () => {
    mockQuery.mockResolvedValueOnce([databaseRow]);

    const result = await listHolisticProgress({
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
    });

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
    expect(mockReconcile).toHaveBeenCalledWith({
      academicYear: "2026-2027",
      schoolCode: undefined,
    });
    expect(sql).toContain("$3::bigint IS NULL OR selected_phase.id IS NOT NULL");
    expect(sql).toContain("THEN 'active'");
    expect(sql).toContain("WHEN notes.state = 'submitted' THEN 'completed'");
    expect(sql).toContain("WHEN notes.state = 'draft' THEN 'pending'");
    expect(sql).toContain("ELSE 'pending'");
    expect(sql).toContain("notes.state = 'submitted' THEN notes.last_edited_at");
    expect(sql).toContain("school_name ASC NULLS LAST, grade ASC NULLS LAST, student_name ASC NULLS LAST");
    expect(sql.indexOf("WHEN notes.state = 'draft' THEN 'pending'"))
      .toBeLessThan(sql.indexOf("base.phase_number < base.initial_active_position"));
    expect(result.counts).toEqual({
      totalMapped: 73,
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
      ],
    };

    const csv = formatHolisticProgressCsv("2026-2027", [row]);

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
    expect(csv).not.toContain("studentId");
    expect(csv).not.toContain("Student Profile");
  });

  it("uses only each Student's latest yearly Mapping for School and Mentor options", async () => {
    mockQuery
      .mockResolvedValueOnce([{ code: "SCH001", name: "School One" }])
      .mockResolvedValueOnce([{ user_id: "9", name: "Current Mentor", email: "current@example.com" }])
      .mockResolvedValueOnce([{ id: "70", position: 2, title: "Check-in", grade: "11", state: "open" }]);

    const options = await getHolisticProgressOptions("2025-2026");

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

  it("returns the current Academic Year first, followed by available prior years", async () => {
    mockQuery.mockResolvedValueOnce([
      { academic_year: "2026-2027" },
      { academic_year: "2025-2026" },
      { academic_year: "2023-2024" },
    ]);

    await expect(getHolisticProgressAcademicYears()).resolves.toEqual([
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

  it("keeps full counts when the requested page has no rows", async () => {
    mockQuery.mockResolvedValueOnce([{
      student_id: null, total_mapped: "51", pending_count: "51", completed_count: "0",
      skipped_count: "0", no_active_phase_count: "0",
    } as never]);

    const result = await listHolisticProgress({
      academicYear: "2026-2027", phaseId: null, schoolCode: null, grade: null,
      mentorUserId: null, progress: null, search: "", sort: "student_name", direction: "asc", page: 3,
    });

    expect(result.rows).toEqual([]);
    expect(result.counts.totalMapped).toBe(51);
  });
});
