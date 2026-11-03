import { describe, expect, it } from "vitest";
import { performancePrograms } from "./performance-program";

describe("performancePrograms", () => {
  it("gives admins (read-only too) and a caller with no row every program", () => {
    expect(performancePrograms({ role: "admin", program_ids: [1] } as never)).toBe("all");
    expect(performancePrograms(null)).toBe("all");
  });

  it("pins PMU roles to JNV NVS, whatever their program_ids", () => {
    expect(performancePrograms({ role: "pmu_manager", program_ids: [1, 64] } as never)).toEqual(new Set(["JNV NVS"]));
  });

  it("gives everyone else the labels of their program_ids, dropping unknown ids", () => {
    expect(performancePrograms({ role: "teacher", program_ids: [1, 74, 999] } as never)).toEqual(new Set(["JNV CoE", "Punjab CoE"]));
    expect(performancePrograms({ role: "program_manager", program_ids: null } as never)).toEqual(new Set());
  });

  it("adds the program of each centre seat, as getProgramContextSync does", () => {
    const seated = (program_ids: number[] | null) =>
      ({ role: "teacher", program_ids, scope: { schools: new Set(), centres: new Set([9]), programs: new Set([74]) } }) as never;
    expect(performancePrograms(seated(null))).toEqual(new Set(["Punjab CoE"]));
    expect(performancePrograms(seated([1]))).toEqual(new Set(["JNV CoE", "Punjab CoE"]));
  });
});
