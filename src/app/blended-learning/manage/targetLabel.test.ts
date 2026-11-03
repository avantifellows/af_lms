import { describe, expect, it } from "vitest";

import { targetLabel } from "./targetLabel";

describe("targetLabel", () => {
  it("names each target", () => {
    expect(targetLabel({ kind: "all" }, null)).toBe("All students with a mentor");
    expect(targetLabel({ kind: "grade", grade: 13 }, null)).toBe("Grade 13 students");
    expect(targetLabel({ kind: "mentor", mentorUserId: 7 }, "Faizan Khan")).toBe("Faizan Khan's students");
    expect(targetLabel({ kind: "mentor", mentorUserId: 7 }, null)).toBe("One mentor's students");
    expect(targetLabel({ kind: "students", studentIds: ["0012345678"] }, null)).toBe("Specific students (1 ID listed)");
    expect(targetLabel({ kind: "students", studentIds: ["1", "2"] }, null)).toBe("Specific students (2 IDs listed)");
  });
});
