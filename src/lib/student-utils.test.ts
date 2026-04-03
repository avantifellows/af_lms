import { describe, expect, it } from "vitest";

import { getStudentDisplayName, type Student } from "./student-utils";

describe("getStudentDisplayName", () => {
  it("returns trimmed full_name when present", () => {
    const student: Student = { id: 1, full_name: "  Rahul Sharma  ", student_id: "STU001", grade: 11 };
    expect(getStudentDisplayName(student)).toBe("Rahul Sharma");
  });

  it("falls back to student_id when full_name is null", () => {
    const student: Student = { id: 2, full_name: null, student_id: "STU002", grade: 12 };
    expect(getStudentDisplayName(student)).toBe("STU002");
  });

  it("falls back to Student #id when both full_name and student_id are null", () => {
    const student: Student = { id: 3, full_name: null, student_id: null, grade: null };
    expect(getStudentDisplayName(student)).toBe("Student #3");
  });
});
