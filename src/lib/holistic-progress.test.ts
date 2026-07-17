import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  formatHolisticProgressCsv,
  listHolisticProgress,
  type HolisticProgressRow,
} from "./holistic-progress";

const mockQuery = vi.mocked(query);

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
  phase_state: "open",
  progress: "completed",
  completed_at: "2026-07-01T10:00:00.000Z",
  notes_author: "Mentor One",
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
  beforeEach(() => mockQuery.mockReset());

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
      sort: "student_name",
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
    expect(sql).toContain("AND ($2 <> $11 OR mapping.ended_at IS NULL)");
    expect(sql).toContain("$3::bigint IS NULL OR selected_phase.id IS NOT NULL");
    expect(sql).toContain("WHEN notes.state = 'submitted' THEN 'completed'");
    expect(sql).toContain("ELSE 'pending'");
    expect(sql).toContain("notes.state = 'submitted' THEN notes.last_edited_at");
    expect(sql).toContain("student_name ASC NULLS LAST, external_student_id ASC NULLS LAST, student_id ASC");
    expect(result.counts).toEqual({
      totalMapped: 73,
      pending: 30,
      completed: 20,
      skipped: 18,
      noActivePhase: 5,
    });
    expect(result.rows[0]).toMatchObject({ studentId: 41, progress: "completed" });
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
      phaseState: "open",
      progress: "completed",
      completedAt: "2026-07-01T10:00:00.000Z",
      notesAuthor: "Mentor One",
      notesLastEditedAt: "2026-07-01T11:00:00.000Z",
      answers: [{ position: 1, question: "+Goal?", answer: "On track" }],
    };

    const csv = formatHolisticProgressCsv("2026-2027", [row]);

    expect(csv).toContain("\"'=SUM(A1:A2)\"");
    expect(csv).toContain("\"School, One\"");
    expect(csv).toContain("\"'+Goal?\"");
    expect(csv).not.toContain("studentId");
    expect(csv).not.toContain("Student Profile");
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
