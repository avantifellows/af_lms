import { describe, expect, it } from "vitest";
import { allowedDegrees, branchGroup } from "./compat";
import { ENUMS } from "./fields";
import { reviewValues, validateValues } from "./validation";

const NOW = { currentYear: 2026, g12Year: 2026 };
const OLD = { currentYear: 2026, g12Year: 2015 };
type V = Record<string, string>;
const review = (v: V, prev: V = {}, ctx = NOW) => reviewValues(v, prev, ctx);
const askIds = (v: V, prev: V = {}, ctx = NOW) => review(v, prev, ctx).warnings.filter((w) => !w.onRecord).map((w) => w.id);
const btech = (start: string, end: string): V => ({ ug_status: "Graduated", degree_ug: "BTech/BE", start_year_ug: start, year_of_graduation_ug: end });

describe("course length", () => {
  it("blocks a 1-year BTech", () => {
    expect(review(btech("2021", "2022"), {}, OLD).errors.year_of_graduation_ug).toMatch(/BTech\/BE takes 4 years/);
  });
  it("accepts a 4-year BTech without asking", () => {
    expect(review(btech("2018", "2022"), {}, OLD).errors).toEqual({});
    expect(askIds(btech("2018", "2022"), {}, OLD)).toEqual([]);
  });
  it("asks to confirm a 3- or 5-year BTech", () => {
    expect(askIds(btech("2019", "2022"), {}, OLD)).toContain("ug-duration");
    expect(askIds(btech("2017", "2022"), {}, OLD)).toContain("ug-duration");
  });
  it("blocks a 9-year BTech and graduation before start", () => {
    expect(review(btech("2013", "2022"), {}, OLD).errors).toHaveProperty("year_of_graduation_ug");
    expect(review(btech("2022", "2020"), {}, OLD).errors).toHaveProperty("year_of_graduation_ug");
  });
  it("knows MBBS takes 5–6 years and BSc 3–4", () => {
    expect(askIds({ ug_status: "Graduated", degree_ug: "MBBS", start_year_ug: "2016", year_of_graduation_ug: "2022" }, {}, OLD)).toEqual([]);
    expect(review({ ug_status: "Graduated", degree_ug: "MBBS", start_year_ug: "2019", year_of_graduation_ug: "2022" }, {}, OLD).errors).toHaveProperty("year_of_graduation_ug");
    expect(askIds({ ug_status: "Graduated", degree_ug: "BSc", start_year_ug: "2018", year_of_graduation_ug: "2022" }, {}, OLD)).toEqual([]);
  });
  it("blocks a 6-year MTech", () => {
    expect(review({ pg_status: "Graduated", degree_pg: "MTech", start_year_pg: "2018", year_of_graduation_pg: "2024" }, {}, OLD).errors).toHaveProperty("year_of_graduation_pg");
  });
});

describe("dates and consistency", () => {
  it("blocks graduating or starting in the future", () => {
    expect(review(btech("2024", "2028")).errors).toHaveProperty("year_of_graduation_ug");
    expect(review({ ug_status: "Studying", start_year_ug: "2027" }).errors).toHaveProperty("start_year_ug");
  });
  it("asks when UG starts before Class 12 ended", () => {
    expect(askIds({ ug_status: "Studying", start_year_ug: "2025" })).toContain("ug-before-g12");
  });
  it("asks / blocks when still studying far too long", () => {
    expect(askIds({ ug_status: "Studying", degree_ug: "BTech/BE", start_year_ug: "2020" }, {}, OLD)).toContain("ug-studying-long");
    expect(review({ ug_status: "Studying", degree_ug: "BTech/BE", start_year_ug: "2015" }, {}, OLD).errors).toHaveProperty("start_year_ug");
  });
  it("blocks PG starting before UG ends", () => {
    expect(review({ year_of_graduation_ug: "2024", start_year_pg: "2023" }, {}, OLD).errors).toHaveProperty("start_year_pg");
  });
  it("checks gap year answers agree", () => {
    expect(review({ did_you_take_a_gap_year: "No", ug_status: "Gap Year" }).errors).toHaveProperty("did_you_take_a_gap_year");
    expect(askIds({ did_you_take_a_gap_year: "No", start_year_ug: "2027" }, {}, { currentYear: 2027, g12Year: 2026 })).toContain("gap-implied");
    expect(askIds({ did_you_take_a_gap_year: "Yes" })).toContain("gap-reason");
  });
  it("blocks Employed vs Not Employed and asks on NEET + BTech", () => {
    expect(review({ current_status: "Employed", employment_status: "Not Employed" }).errors).toHaveProperty("employment_status");
    expect(askIds({ which_competitive_exam_did_you_appear_for: "NEET", degree_ug: "BTech/BE" })).toContain("exam-vs-degree");
  });
  it("catches CTC entered in lakhs or per month, and a mismatched range", () => {
    const job = { employment_status: "Employed - Full-time" };
    expect(askIds({ ...job, current_ctc: "6" })).toContain("ctc-lakhs");
    expect(askIds({ ...job, current_ctc: "50000" })).toContain("ctc-monthly");
    expect(askIds({ ...job, current_ctc: "900000", current_ctc_range: "INR 6 to 9 LPA" })).toEqual([]);
    expect(askIds({ ...job, current_ctc: "500000", current_ctc_range: "INR 9 to 12 LPA" })).toContain("ctc-range");
  });
  it("asks when experience is longer than their working years", () => {
    expect(askIds({ employment_status: "Employed - Full-time", which_year_did_you_start_working: "2023", years_of_experience: "10" })).toContain("exp-vs-start");
  });
});

describe("old records", () => {
  const rec = btech("2013", "2022");
  it("never blocks on values already on record that weren't changed", () => {
    const r = review({ ...rec, contact_status: "Contacted - Positive Response" }, rec, OLD);
    expect(r.errors).not.toHaveProperty("year_of_graduation_ug");
    expect(r.warnings.some((w) => w.onRecord)).toBe(true);
  });
  it("re-checks once one of those values is changed", () => {
    expect(review({ ...rec, year_of_graduation_ug: "2023" }, rec, OLD).errors).toHaveProperty("year_of_graduation_ug");
  });
  it("keeps an existing off-list dropdown value", () => {
    expect(validateValues({ ug_status: "Old Value" }, { ug_status: "Old Value" })).toEqual({});
    expect(validateValues({ ug_status: "Whatever" })).toHaveProperty("ug_status");
  });
});

describe("degree must fit the branch", () => {
  it("groups branch codes by prefix", () => {
    expect(branchGroup("ELEC067")).toBe("ELEC");
  });
  it("rejects MBBS for CS/IT, accepts BTech and BCA", () => {
    expect(validateValues({ branch_id_ug: "CSIT012", degree_ug: "MBBS" })).toHaveProperty("degree_ug");
    expect(validateValues({ branch_id_ug: "CSIT012", degree_ug: "BTech/BE" })).toEqual({});
    expect(validateValues({ branch_id_ug: "CSIT", degree_ug: "BCA" })).toEqual({});
  });
  it("leaves a mismatched pair already on record alone", () => {
    const pair = { branch_id_ug: "ELEC067", degree_ug: "MBBS" };
    expect(validateValues(pair, pair)).toEqual({});
    expect(validateValues({ ...pair, branch_id_ug: "CSIT001" }, pair)).toHaveProperty("degree_ug");
  });
  it("only lists degrees that exist in the dropdowns", () => {
    for (const level of ["ug", "pg"] as const) {
      for (const group of ["CSIT", "MBBS", "DENTAL", "PHARMA", "LLB", "BCA", "MBA", "COMMERCE"]) {
        for (const d of allowedDegrees(level, group) ?? []) expect(ENUMS[`degree_${level}`]).toContain(d);
      }
    }
  });
});
