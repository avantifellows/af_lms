import { describe, expect, it } from "vitest";

import { getTeacherDisplayName, type Teacher } from "./teacher-utils";

describe("getTeacherDisplayName", () => {
  it("returns full_name when present", () => {
    const teacher: Teacher = { id: 1, email: "a@test.com", full_name: "Alice Smith" };
    expect(getTeacherDisplayName(teacher)).toBe("Alice Smith");
  });

  it("falls back to email when full_name is null", () => {
    const teacher: Teacher = { id: 2, email: "b@test.com", full_name: null };
    expect(getTeacherDisplayName(teacher)).toBe("b@test.com");
  });

  it("falls back to email when full_name is empty string", () => {
    const teacher: Teacher = { id: 3, email: "c@test.com", full_name: "" };
    expect(getTeacherDisplayName(teacher)).toBe("c@test.com");
  });
});
