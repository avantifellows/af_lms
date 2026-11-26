import { describe, expect, it } from "vitest";

import {
  HOLISTIC_PHASES_PER_GRADE, holisticGradeFullError, holisticPhaseNumber, holisticPhaseNumberSql,
  withHolisticPhaseNumbers,
} from "./holistic-phase-number";

describe("Holistic Phase numbers (issue #516)", () => {
  it("numbers Grade 11 Phases 1 to 3 and Grade 12 Phases 4 to 6", () => {
    expect([1, 2, 3].map((place) => holisticPhaseNumber(11, place))).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((place) => holisticPhaseNumber(12, place))).toEqual([4, 5, 6]);
  });

  it("numbers each Grade by its own order in a Plan that mixes Grades", () => {
    const plan = [
      { id: 1, grade: 11 as const, position: 1 },
      { id: 2, grade: 12 as const, position: 2 },
      { id: 15, grade: 11 as const, position: 3 },
      { id: 16, grade: 12 as const, position: 4 },
    ];

    expect(withHolisticPhaseNumbers(plan).map(({ id, number }) => [id, number]))
      .toEqual([[1, 1], [2, 4], [15, 2], [16, 5]]);
  });

  it("does not depend on the order the Phases are given in, or on gaps in position", () => {
    const plan = [
      { id: 16, grade: 12 as const, position: 40 },
      { id: 15, grade: 11 as const, position: 30 },
      { id: 2, grade: 12 as const, position: 7 },
      { id: 1, grade: 11 as const, position: 2 },
    ];

    expect(withHolisticPhaseNumbers(plan).map(({ id, number }) => [id, number]))
      .toEqual([[16, 5], [15, 2], [2, 4], [1, 1]]);
  });

  it("numbers a Grade 12 Phase 4 when the Plan has no Grade 11 Phase, and an empty Plan gives nothing", () => {
    expect(withHolisticPhaseNumbers([{ grade: 12 as const, position: 1 }])).toEqual([
      { grade: 12, position: 1, number: 4 },
    ]);
    expect(withHolisticPhaseNumbers([])).toEqual([]);
  });

  it("builds the same rule as SQL from the calling query's aliases", () => {
    const sql = holisticPhaseNumberSql("phase", "phase_grade.number").replace(/\s+/g, " ");

    expect(sql).toContain("same_grade_phase.phase_plan_id = phase.phase_plan_id");
    expect(sql).toContain("same_grade_phase.grade_id = phase.grade_id");
    expect(sql).toContain("same_grade_phase.position <= phase.position");
    expect(sql).toContain(`CASE WHEN phase_grade.number = 12 THEN ${HOLISTIC_PHASES_PER_GRADE} ELSE 0 END`);
  });

  it("names the full Grade in the refusal", () => {
    expect(holisticGradeFullError(12)).toBe("Grade 12 already has 3 Phases");
  });
});
