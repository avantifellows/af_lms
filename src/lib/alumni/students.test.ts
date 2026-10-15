import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { cohortParams, listAlumniForSchool, listPendingForSchool } from "./students";

const mockQuery = vi.mocked(query);
const SCHOOL = { id: "7", code: "59525" };

beforeEach(() => {
  mockQuery.mockReset();
});

describe("cohortParams", () => {
  it("uses the current academic year, Grade 12 and the alumni programs in attribution order", () => {
    const [year, grade, programs] = cohortParams();
    expect(year).toMatch(/^\d{4}-\d{4}$/);
    expect(grade).toBe(12);
    expect(programs).toEqual([1, 86, 87, 2, 94]);
  });
});

describe("listPendingForSchool", () => {
  it("narrows to the School's members and maps rows, newest pass-out year first then by name", async () => {
    mockQuery.mockResolvedValue([
      { user_id: "3", afid: null, first_name: "Zara", last_name: null, passout_year: "2025-2026", program: "JNV CoE", gender: null, stream: null },
      { user_id: "1", afid: "A1", first_name: "  Asha ", last_name: "Rao", passout_year: "2025-2026", program: "JNV CoE", gender: "Female", stream: "engineering" },
      { user_id: "2", afid: "A2", first_name: null, last_name: null, passout_year: "2019-2020", program: "JNV Nodal", gender: null, stream: null },
    ] as never);

    const rows = await listPendingForSchool(SCHOOL);

    expect(rows.map((r) => r.name)).toEqual(["Asha Rao", "Zara", "(no name)"]);
    expect(rows[0]).toEqual({
      userId: "1", afid: "A1", name: "Asha Rao", cohortYear: "2025-2026", program: "JNV CoE", gender: "Female", stream: "engineering",
    });
    expect(rows[1]).toMatchObject({ afid: "", gender: "", stream: "" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("e2.group_type = 'school' AND e2.group_id = $4");
    expect(sql).toContain("NOT is_alumni AND COALESCE(status, '') <> 'dropout'");
    expect(params?.slice(3)).toEqual(["7", "59525"]);
  });
});

describe("listAlumniForSchool", () => {
  it("keeps alumni whose latest School is this one, newest cohort first", async () => {
    mockQuery.mockResolvedValue([
      { alumni_id: "95", user_id: "5", afid: "B1", first_name: "Ravi", last_name: "Kumar", cohort_year: "2018-2019", ug_status: "Graduated", current_status: null, college_ug: " NIT  Calicut " },
      { alumni_id: "96", user_id: "6", afid: null, first_name: "Meena", last_name: null, cohort_year: null, ug_status: null, current_status: "Employed", college_ug: null },
      { alumni_id: "94", user_id: "4", afid: "B2", first_name: "Anil", last_name: null, cohort_year: "2019-2020", ug_status: null, current_status: null, college_ug: null },
    ] as never);

    const rows = await listAlumniForSchool(SCHOOL);

    expect(rows.map((r) => r.name)).toEqual(["Anil", "Ravi Kumar", "Meena"]);
    expect(rows[1]).toEqual({
      alumniId: "95", userId: "5", afid: "B1", name: "Ravi Kumar", cohortYear: "2018-2019", ugStatus: "Graduated", currentStatus: "", collegeUg: "NIT Calicut",
    });
    expect(rows[2]).toMatchObject({ afid: "", cohortYear: "", currentStatus: "Employed", collegeUg: "" });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE school_code = $2");
    expect(params).toEqual(["7", "59525"]);
  });
});
