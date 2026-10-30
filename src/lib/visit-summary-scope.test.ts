import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@/lib/db", () => ({ query: mockQuery }));

import type { UserPermission } from "@/lib/permissions";
import { buildVisitsActor } from "@/lib/visits-policy";
import {
  buildVisitSummarySchoolPredicate,
  buildVisitSummaryWhere,
  getVisitSummaryPmOptions,
  getVisitSummaryRegionOptions,
  getVisitSummarySchoolOptions,
  normalizeVisitSummaryFilters,
} from "./visit-summary-scope";

const adminActor = buildVisitsActor("admin@avantifellows.org", {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  read_only: false,
  program_ids: [1],
} as UserPermission);

describe("Visit Summary scope", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("Manual dates", () => {
    it("keep a real calendar date", () => {
      expect(normalizeVisitSummaryFilters({ from: "2028-02-29", to: "2026-12-31" })).toMatchObject({
        from: "2028-02-29",
        to: "2026-12-31",
      });
    });

    it("drop a date shaped like YYYY-MM-DD that isn't on the calendar, so Postgres never sees it", () => {
      for (const date of ["2026-13-45", "2026-02-29", "2026-04-31", "2026-00-10", "2026-01-00"]) {
        const filters = normalizeVisitSummaryFilters({ from: date, to: date });
        expect(filters.from).toBeUndefined();
        expect(filters.to).toBeUndefined();
      }
    });
  });

  describe("School options", () => {
    it("ignore the School filter but keep the PM and status filters", async () => {
      mockQuery.mockResolvedValueOnce([
        { code: "SC001", name: "Anand School" },
        { code: "SC002", name: "Bhuj School" },
      ]);
      const filters = normalizeVisitSummaryFilters({
        schools: "SC001",
        pms: "PM@Example.org",
        status: "completed",
      });

      const options = await getVisitSummarySchoolOptions(adminActor, filters);

      expect(options).toEqual([
        { code: "SC001", name: "Anand School" },
        { code: "SC002", name: "Bhuj School" },
      ]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][1]).toEqual([["pm@example.org"], "completed"]);
    });
  });

  describe("PM options", () => {
    it("ignore the PM filter but keep the School and date filters", async () => {
      mockQuery.mockResolvedValueOnce([
        { email: "other@example.org", name: null },
        { email: "pm@example.org", name: "Program Manager" },
      ]);
      const filters = normalizeVisitSummaryFilters({
        schools: "SC001,SC002",
        pms: "pm@example.org",
        from: "2026-05-01",
        to: "2026-05-31",
      });

      const options = await getVisitSummaryPmOptions(adminActor, filters);

      expect(options).toEqual([
        { email: "other@example.org", name: null },
        { email: "pm@example.org", name: "Program Manager" },
      ]);
      expect(mockQuery.mock.calls[0][1]).toEqual([["SC001", "SC002"], "2026-05-01", "2026-05-31"]);
    });
  });

  describe("Region options", () => {
    it("label Schools with no region as 'No region (non-JNV)' and ignore the Region filter", async () => {
      mockQuery.mockResolvedValueOnce([{ region: "Bhopal" }, { region: "Hyderabad" }, { region: null }]);
      const filters = normalizeVisitSummaryFilters({
        regions: "Bhopal",
        pms: "pm@example.org",
      });

      const options = await getVisitSummaryRegionOptions(adminActor, filters);

      expect(options).toEqual([
        { value: "Bhopal", label: "Bhopal" },
        { value: "Hyderabad", label: "Hyderabad" },
        { value: "__none__", label: "No region (non-JNV)" },
      ]);
      expect(mockQuery.mock.calls[0][1]).toEqual([["pm@example.org"]]);
    });
  });

  describe("Region filter", () => {
    it("narrows the School options to the picked named regions", async () => {
      mockQuery.mockResolvedValueOnce([]);
      const filters = normalizeVisitSummaryFilters({ regions: "Bhopal, Hyderabad" });

      await getVisitSummarySchoolOptions(adminActor, filters);

      expect(mockQuery.mock.calls[0][1]).toEqual([["Bhopal", "Hyderabad"]]);
    });
  });

  describe("School on the Visit Summary", () => {
    const columns = { startIndex: 2, schoolCodeColumn: "s.code", schoolRegionColumn: "s.region" };
    const physical = /^EXISTS \(\s*SELECT 1\s+FROM school physical_school\s+JOIN centres physical_centre ON physical_centre\.school_id = physical_school\.id\s+WHERE physical_school\.code = s\.code\s+AND physical_centre\.is_physical AND physical_centre\.is_active\s*\)/;

    it("needs an active physical Centre, with no scope clause for an unscoped admin", () => {
      const { clause, params } = buildVisitSummarySchoolPredicate(adminActor, columns);

      expect(clause).toMatch(physical);
      expect(clause).not.toContain(" AND s.");
      expect(params).toEqual([]);
    });

    it("adds a seated PM's visit-managed Schools as a placeholder from startIndex", () => {
      const pm = buildVisitsActor("pm@avantifellows.org", {
        email: "pm@avantifellows.org",
        level: 3,
        role: "program_manager",
        read_only: false,
        program_ids: [1],
        scope: { visitManagedSchools: new Set(["SC001", "SC002"]) },
      } as unknown as UserPermission);

      const { clause, params } = buildVisitSummarySchoolPredicate(pm, columns);

      expect(clause).toMatch(physical);
      expect(clause).toMatch(/\) AND s\.code = ANY\(\$2\)$/);
      expect(params).toEqual([["SC001", "SC002"]]);
    });

    it("is the rule the Visits in view use, on the Visit's School code", () => {
      const { whereSql } = buildVisitSummaryWhere(adminActor);

      expect(whereSql).toContain("WHERE physical_school.code = v.school_code");
    });
  });
});
