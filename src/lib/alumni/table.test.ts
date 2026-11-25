import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import type { UserPermission } from "@/lib/permissions";
import { completeness, filterTable, loadAlumniTable, summarizeTable, tableYears, type AlumniTableRow } from "./table";

const mockQuery = vi.mocked(query);
const perm = (overrides: Partial<UserPermission> = {}) =>
  ({ email: "x@avantifellows.org", level: 3, role: "admin", read_only: false, ...overrides }) as UserPermission;

const row = (overrides: Partial<AlumniTableRow>): AlumniTableRow => ({
  kind: "alumnus",
  id: "1",
  name: "Ampoli Ram Charan",
  afid: "2632401171",
  phone: "",
  whatsapp: "",
  cohortYear: "2025-2026",
  program: "JNV CoE",
  schoolCode: "59525",
  schoolName: "JNV Adilabad",
  values: { contact_status: "", current_status: "", ug_status: "", college_id_ug: "", branch_id_ug: "", degree_ug: "", employment_status: "" },
  filledPct: 0,
  missing: [],
  updatedAt: "",
  ...overrides,
});

describe("completeness", () => {
  it("counts only the fields the form shows for these answers", () => {
    const blank = completeness({});
    expect(blank.missing).toContain("contact_status");
    expect(blank.missing).not.toContain("college_id_ug"); // no UG section before a UG status
    expect(blank.filledPct).toBe(0);

    const studying = completeness({ ug_status: "Studying", current_status: "Studying", contact_status: "Not Contacted" });
    expect(studying.missing).toContain("college_id_ug");
    expect(studying.missing).not.toContain("ug_status");
    expect(studying.filledPct).toBeGreaterThan(0);
  });
});

describe("filterTable / summarizeTable / tableYears", () => {
  const rows = [
    row({ id: "1", missing: ["college_id_ug"] }),
    row({ id: "2", name: "Bhanu", kind: "pass-out", cohortYear: "2024-2025", missing: ["contact_status"] }),
    row({ id: "3", name: "Chitra", schoolCode: "49060", values: { ...row({}).values, ug_status: "Studying" } }),
  ];

  it("filters by year, record, school, search (name or AFID) and field", () => {
    const ids = (f: Parameters<typeof filterTable>[1]) => filterTable(rows, f).map((r) => r.id);
    expect(ids({ years: ["2024-2025"] })).toEqual(["2"]);
    expect(ids({ record: "added" })).toEqual(["1", "3"]);
    expect(ids({ record: "not-added" })).toEqual(["2"]);
    expect(ids({ school: "49060" })).toEqual(["3"]);
    expect(ids({ q: "bhan" })).toEqual(["2"]);
    expect(ids({ q: "26324" })).toEqual(["1", "2", "3"]);
    expect(ids({ fields: { college_id_ug: "missing" } })).toEqual(["1"]);
    expect(ids({ fields: { ug_status: "filled" } })).toEqual(["3"]);
  });

  it("summarises before the field filters", () => {
    expect(summarizeTable(rows, { fields: { college_id_ug: "missing" } })).toMatchObject({
      total: 3,
      notAdded: 1,
      missing: { college_id_ug: 1, contact_status: 1 },
    });
  });

  it("lists pass-out years newest first", () => {
    expect(tableYears([...rows, row({ cohortYear: "" })])).toEqual(["2025-2026", "2024-2025"]);
  });
});

describe("loadAlumniTable", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("cohort_flagged f")) {
        return [{ user_id: "86655", afid: "263", first_name: "Bhanu", last_name: null, passout_year: "2025-2026", program: "JNV CoE", school_code: "59525", school_name: "JNV Adilabad", phone: "98", whatsapp_phone: null }] as never;
      }
      return [{
        id: "8340", first_name: "Ampoli", last_name: "Ram", afid: "2632401171", phone: "97", whatsapp_phone: "97",
        ug_status: "Studying", current_status: "Studying", contact_status: "Contacted - Positive Response",
        college_code_ug: "C-19609", college_name_ug: "Nalla Malla Reddy", college_id_ug: "40947",
        school_code: "59525", school_name: "JNV Adilabad", cohort_year: "2025-2026", program: "JNV CoE", updated: "2026-11-23 10:00:00",
      }] as never;
    });
  });

  it("lists pass-outs before alumni in a year, with college names and how complete each record is", async () => {
    const rows = await loadAlumniTable(perm(), "59525");
    expect(rows.map((r) => [r.kind, r.name])).toEqual([["pass-out", "Bhanu"], ["alumnus", "Ampoli Ram"]]);
    expect(rows[1]).toMatchObject({ id: "8340", updatedAt: "2026-11-23", values: { college_id_ug: "Nalla Malla Reddy", ug_status: "Studying" } });
    expect(rows[1].missing).toContain("branch_id_ug");
    expect(rows[0]).toMatchObject({ id: "86655", phone: "98", whatsapp: "", values: { ug_status: "" } });
  });

  it("narrows to one school, or to a manager's schools, in SQL", async () => {
    await loadAlumniTable(perm(), "59525");
    expect(mockQuery.mock.calls.every(([sql]) => sql.includes("sc.code = $") || sql.includes("sch.code = $"))).toBe(true);

    mockQuery.mockClear();
    await loadAlumniTable(perm({ role: "alumni_manager", level: 1, school_codes: ["59525"] }));
    expect(mockQuery.mock.calls.every(([sql]) => sql.includes("members AS MATERIALIZED"))).toBe(true);

    mockQuery.mockClear();
    await loadAlumniTable(perm());
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes("members AS MATERIALIZED"))).toBe(false);
  });
});
