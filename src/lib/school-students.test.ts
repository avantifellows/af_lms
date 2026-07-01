import { describe, it, expect, vi, beforeEach } from "vitest";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import type { Student } from "@/components/StudentTable";

const mocks = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));

import { getSchoolRoster, filterActiveRosterStudents } from "./school-students";

function makeStudent(overrides: Partial<Student> = {}): Student {
  const user_id = overrides.user_id ?? "u-1";
  return {
    group_user_id: `gu-${user_id}`,
    user_id,
    student_pk_id: null,
    first_name: "Alice",
    last_name: "Smith",
    phone: null,
    email: null,
    date_of_birth: null,
    student_id: "stu-1",
    apaar_id: null,
    category: null,
    stream: null,
    gender: null,
    program_name: null,
    program_id: null,
    grade: 12,
    grade_id: null,
    status: null,
    updated_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.mockQuery.mockReset();
  // Default for follow-up queries (e.g. the multi-school issue check).
  mocks.mockQuery.mockResolvedValue([]);
});

describe("getSchoolRoster", () => {
  it("queries the canonical roster scoped to the current academic year", async () => {
    mocks.mockQuery.mockResolvedValueOnce([]);

    await getSchoolRoster("school-1");

    expect(mocks.mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.mockQuery.mock.calls[0];
    expect(sql).toContain("g.type = 'school' AND g.child_id = $1");
    expect(sql).toContain("er.academic_year = $2");
    // Inner join (not LEFT) so prior-year grade cohorts are excluded entirely.
    expect(sql).toContain("JOIN LATERAL (\n      SELECT er.group_id");
    expect(sql).toContain("AND (er.is_current = true OR s.status = 'dropout')");
    expect(sql).toContain("JOIN batch b ON b.id = er_batch.group_id");
    expect(sql).toContain("er_batch.end_date DESC NULLS LAST");
    expect(params).toEqual(["school-1", CURRENT_ACADEMIC_YEAR]);
  });

  it("returns deduplicated students plus data issues via processStudents", async () => {
    // Same group_user_id twice (duplicate current grade enrollments).
    mocks.mockQuery.mockResolvedValueOnce([
      makeStudent({ group_user_id: "gu-dup", grade: 11 }),
      makeStudent({ group_user_id: "gu-dup", grade: 12 }),
    ]);

    const { students, issues } = await getSchoolRoster("school-1");

    expect(students).toHaveLength(1);
    expect(students[0].grade).toBe(12); // keeps the highest grade
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("duplicate_grade");
  });
});

describe("filterActiveRosterStudents", () => {
  it("excludes dropout students", () => {
    const students = [
      makeStudent({ user_id: "u-1", status: "dropout" }),
      makeStudent({ user_id: "u-2", status: "enrolled" }),
      makeStudent({ user_id: "u-3", status: null }),
    ];
    const result = filterActiveRosterStudents(students);
    expect(result.map((s) => s.user_id)).toEqual(["u-2", "u-3"]);
  });

  it("filters by grade with strict equality", () => {
    const students = [
      makeStudent({ user_id: "u-1", grade: 11 }),
      makeStudent({ user_id: "u-2", grade: 12 }),
      makeStudent({ user_id: "u-3", grade: null }),
    ];
    const result = filterActiveRosterStudents(students, { grade: 12 });
    expect(result.map((s) => s.user_id)).toEqual(["u-2"]);
  });

  it("filters by the roster's single attributed program name", () => {
    const students = [
      makeStudent({ user_id: "u-1", program_name: "CoE" }),
      makeStudent({ user_id: "u-2", program_name: "NVS" }),
      makeStudent({ user_id: "u-3", program_name: null }),
    ];
    const result = filterActiveRosterStudents(students, { program: "CoE" });
    expect(result.map((s) => s.user_id)).toEqual(["u-1"]);
  });

  it("filters by stream case-insensitively and excludes null streams", () => {
    const students = [
      makeStudent({ user_id: "u-1", stream: "PCM" }),
      makeStudent({ user_id: "u-2", stream: " pcm " }),
      makeStudent({ user_id: "u-3", stream: "PCB" }),
      makeStudent({ user_id: "u-4", stream: null }),
    ];
    const result = filterActiveRosterStudents(students, { stream: "pcm" });
    expect(result.map((s) => s.user_id)).toEqual(["u-1", "u-2"]);
  });

  it("combines filters and returns all active students when no filters given", () => {
    const students = [
      makeStudent({ user_id: "u-1", grade: 12, program_name: "CoE", stream: "PCM" }),
      makeStudent({ user_id: "u-2", grade: 12, program_name: "CoE", stream: "PCB" }),
      makeStudent({ user_id: "u-3", grade: 11, program_name: "CoE", stream: "PCM" }),
      makeStudent({ user_id: "u-4", grade: 12, program_name: "NVS", stream: "PCM" }),
      makeStudent({ user_id: "u-5", grade: 12, program_name: "CoE", stream: "PCM", status: "dropout" }),
    ];
    expect(filterActiveRosterStudents(students)).toHaveLength(4);
    expect(
      filterActiveRosterStudents(students, {
        grade: 12,
        program: "CoE",
        stream: "pcm",
      }).map((s) => s.user_id)
    ).toEqual(["u-1"]);
  });
});
