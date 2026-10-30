import { describe, expect, it } from "vitest";
import { performancePrograms } from "./performance-program";

describe("performancePrograms", () => {
  it("gives admins (read-only too) and a caller with no row every program", () => {
    expect(performancePrograms({ role: "admin", program_ids: [1] })).toBe("all");
    expect(performancePrograms(null)).toBe("all");
  });

  it("pins PMU roles to JNV NVS, whatever their program_ids", () => {
    expect(performancePrograms({ role: "pmu_manager", program_ids: [1, 64] })).toEqual(new Set(["JNV NVS"]));
  });

  it("gives everyone else the labels of their program_ids, dropping unknown ids", () => {
    expect(performancePrograms({ role: "teacher", program_ids: [1, 74, 999] })).toEqual(new Set(["JNV CoE", "Punjab CoE"]));
    expect(performancePrograms({ role: "program_manager", program_ids: null })).toEqual(new Set());
  });
});
