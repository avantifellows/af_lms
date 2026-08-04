import { describe, it, expect } from "vitest";
import {
  buildProgramStats,
  studentDroppedFromProgram,
} from "./enrollment-stats";
import { PROGRAM_IDS } from "./permissions";

type S = {
  program_id: number | null;
  grade: number | null;
  gender: string | null;
  category: string | null;
};

const mk = (s: Partial<S>): S => ({
  program_id: null,
  grade: null,
  gender: null,
  category: null,
  ...s,
});

describe("buildProgramStats", () => {
  it("scopes to the given program_id and sets a known label", () => {
    const students: S[] = [
      mk({
        program_id: PROGRAM_IDS.NVS,
        grade: 11,
        gender: "Female",
        category: "ST",
      }),
      mk({
        program_id: PROGRAM_IDS.COE,
        grade: 12,
        gender: "Male",
        category: "OBC",
      }),
    ];

    const stats = buildProgramStats(students, PROGRAM_IDS.NVS);
    expect(stats.id).toBe(PROGRAM_IDS.NVS);
    expect(stats.label).toBe("JNV NVS");
    expect(stats.total).toBe(1);
  });

  it("falls back to a generic label for an unknown program", () => {
    const stats = buildProgramStats([], 999);
    expect(stats.label).toBe("Program 999");
    expect(stats.total).toBe(0);
    expect(stats.byGrade).toEqual([]);
    expect(stats.byGender).toEqual([]);
    expect(stats.byCategory).toEqual([]);
  });

  it("groups grades ascending and excludes null grades", () => {
    const students: S[] = [
      mk({ program_id: PROGRAM_IDS.NVS, grade: 12 }),
      mk({ program_id: PROGRAM_IDS.NVS, grade: 11 }),
      mk({ program_id: PROGRAM_IDS.NVS, grade: 11 }),
      mk({ program_id: PROGRAM_IDS.NVS, grade: null }),
    ];
    const stats = buildProgramStats(students, PROGRAM_IDS.NVS);
    expect(stats.total).toBe(4);
    expect(stats.byGrade).toEqual([
      { grade: 11, count: 2 },
      { grade: 12, count: 1 },
    ]);
  });

  it("buckets null/empty gender and category as 'Unspecified' and sorts by count desc", () => {
    const students: S[] = [
      mk({ program_id: PROGRAM_IDS.COE, gender: "Male", category: "OBC" }),
      mk({ program_id: PROGRAM_IDS.COE, gender: "Male", category: "OBC" }),
      mk({ program_id: PROGRAM_IDS.COE, gender: "Female", category: "SC" }),
      mk({ program_id: PROGRAM_IDS.COE, gender: null, category: null }),
      mk({ program_id: PROGRAM_IDS.COE, gender: "   ", category: "   " }),
    ];
    const stats = buildProgramStats(students, PROGRAM_IDS.COE);
    expect(stats.byGender).toEqual([
      { value: "Male", count: 2 },
      { value: "Unspecified", count: 2 },
      { value: "Female", count: 1 },
    ]);
    expect(stats.byCategory).toEqual([
      { value: "OBC", count: 2 },
      { value: "Unspecified", count: 2 },
      { value: "SC", count: 1 },
    ]);
  });

  it("trims gender and category whitespace", () => {
    const students: S[] = [
      mk({
        program_id: PROGRAM_IDS.NVS,
        gender: "  Male  ",
        category: "  OBC  ",
      }),
    ];
    const stats = buildProgramStats(students, PROGRAM_IDS.NVS);
    expect(stats.byGender).toEqual([{ value: "Male", count: 1 }]);
    expect(stats.byCategory).toEqual([{ value: "OBC", count: 1 }]);
  });

  it("ignores students from other programs", () => {
    const students: S[] = [
      mk({
        program_id: PROGRAM_IDS.COE,
        grade: 11,
        gender: "Male",
        category: "OBC",
      }),
      mk({
        program_id: PROGRAM_IDS.NVS,
        grade: 11,
        gender: "Female",
        category: "ST",
      }),
    ];
    const stats = buildProgramStats(students, PROGRAM_IDS.NVS);
    expect(stats.total).toBe(1);
    expect(stats.byGrade).toEqual([{ grade: 11, count: 1 }]);
    expect(stats.byGender).toEqual([{ value: "Female", count: 1 }]);
  });

  it("counts a multi-program student in each current program", () => {
    const student = {
      ...mk({ program_id: PROGRAM_IDS.COE, grade: 11 }),
      student_program_ids: [PROGRAM_IDS.COE, PROGRAM_IDS.NVS],
    };

    expect(buildProgramStats([student], PROGRAM_IDS.COE).total).toBe(1);
    expect(buildProgramStats([student], PROGRAM_IDS.NVS).total).toBe(1);
  });

  it("tracks a program dropout while another program stays active", () => {
    const student = {
      ...mk({ program_id: PROGRAM_IDS.NVS }),
      status: "active",
      dropout_program_ids: [PROGRAM_IDS.COE],
    };

    expect(studentDroppedFromProgram(student, PROGRAM_IDS.COE)).toBe(true);
    expect(studentDroppedFromProgram(student, PROGRAM_IDS.NVS)).toBe(false);
  });
});
