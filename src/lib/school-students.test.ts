import { describe, it, expect, vi, beforeEach } from "vitest";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_ATTRIBUTION_ORDER } from "@/lib/constants";
import type { Student } from "@/components/StudentTable";

const mocks = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  query: mocks.mockQuery,
}));

import {
  getSchoolRoster,
  getCentreStudents,
  filterActiveRosterStudents,
} from "./school-students";

function expectMaterializedDropoutAuditLookup(sql: string) {
  expect(sql).toMatch(
    /WITH program_dropout_audits AS MATERIALIZED \(\s*SELECT action, program_id, affected_identifiers\s*FROM lms_student_write_audits\s*WHERE action = 'student_program_dropout'\s*\)/,
  );
  expect(sql).toMatch(
    /AS dropout_program_ids\s*FROM program_dropout_audits audit\s*WHERE audit\.action = 'student_program_dropout'\s*AND \(audit\.affected_identifiers ->> 'student_pk_id'\)::bigint = s\.id\s*AND NOT \(audit\.program_id = ANY\(sp\.student_program_ids\)\)/,
  );
  expect(sql).not.toMatch(
    /AS dropout_program_ids\s*FROM lms_student_write_audits audit/,
  );

  // Undo eligibility intentionally continues to use the complete audit table.
  expect(sql).toMatch(
    /FROM lms_student_write_audits dropout\s*WHERE dropout\.action = 'student_program_dropout'/,
  );
  expect(sql).toMatch(
    /FROM lms_student_write_audits undo\s*WHERE undo\.action = 'student_program_dropout_undo'\s*AND \(undo\.affected_identifiers ->> 'dropout_audit_id'\)::bigint = dropout\.id/,
  );
}

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
    student_program_ids: null,
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
    expect(sql).toContain("er_grade.academic_year = $2");
    // Inner join (not LEFT) so prior-year grade cohorts are excluded entirely.
    expect(sql).toContain("JOIN enrollment_record er_grade ON er_grade.user_id = u.id");
    expect(sql).toContain("er_grade.is_current = true");
    expect(sql).toContain("s.status = 'dropout'");
    expect(sql).toContain("SELECT er_latest.id");
    expect(sql).toContain("JOIN batch b ON b.id = er_batch.group_id");
    expect(sql).toContain("AS student_program_ids");
    expect(sql).toContain("AS can_undo_nvs_dropout");
    expect(sql).toContain("s.pen_number");
    expect(sql).toContain("er_batch.end_date DESC NULLS LAST");
    expect(sql).toContain("b_phone_nvs.program_id = $3");
    expect(sql).toContain("array_position($4::int[], b.program_id)");
    expectMaterializedDropoutAuditLookup(sql);
    expect(params).toEqual(["school-1", CURRENT_ACADEMIC_YEAR, 64, PROGRAM_ATTRIBUTION_ORDER]);
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

describe("getCentreStudents", () => {
  it("queries the centre_students view scoped to the centre + current academic year", async () => {
    mocks.mockQuery.mockResolvedValueOnce([]);

    await getCentreStudents("centre-8");

    expect(mocks.mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.mockQuery.mock.calls[0];
    // Membership is authoritative from the view, not re-derived.
    expect(sql).toContain("FROM centre_students cs");
    expect(sql).toContain("cs.centre_id = $1");
    expect(sql).toContain("cs.academic_year = $2");
    // Hydration joins the current-year grade enrollment (for grade_id).
    expect(sql).toContain("JOIN enrollment_record er_grade");
    expect(sql).toContain("b_phone_nvs.program_id = $3");
    expectMaterializedDropoutAuditLookup(sql);
    expect(params).toEqual(["centre-8", CURRENT_ACADEMIC_YEAR, 64]);
  });

  it("hydrates via the shared column list, identical to the school roster", async () => {
    // Both functions select the shared STUDENT_COLUMNS block, so their row
    // shapes cannot drift. Assert the block's first + last columns appear in
    // each query's SQL.
    const first = "gu.id as group_user_id";
    const last = "GREATEST(s.updated_at, u.updated_at) as updated_at";

    mocks.mockQuery.mockResolvedValueOnce([]);
    await getCentreStudents("centre-8");
    const [centreSql] = mocks.mockQuery.mock.calls[0];

    mocks.mockQuery.mockResolvedValueOnce([]);
    await getSchoolRoster("school-1");
    const [rosterSql] = mocks.mockQuery.mock.calls[1];

    expect(centreSql).toContain(first);
    expect(centreSql).toContain(last);
    expect(rosterSql).toContain(first);
    expect(rosterSql).toContain(last);
  });

  it("returns deduplicated students plus data issues via processStudents", async () => {
    // A student with two current grade enrollments yields duplicate view rows.
    mocks.mockQuery.mockResolvedValueOnce([
      makeStudent({ group_user_id: "gu-dup", grade: 11 }),
      makeStudent({ group_user_id: "gu-dup", grade: 12 }),
    ]);

    const { students, issues } = await getCentreStudents("centre-8");

    expect(students).toHaveLength(1);
    expect(students[0].grade).toBe(12);
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
