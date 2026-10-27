import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@/lib/db", () => ({ query: mockQuery }));

import type { UserPermission } from "@/lib/permissions";
import { buildVisitsActor } from "@/lib/visits-policy";
import {
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
});
