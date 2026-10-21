import { describe, expect, it } from "vitest";
import { afterSave, reviewSave, visibleValues } from "./validation";

// The review runs on the record as it will be after the save: a blank is
// never sent, so the saved value stays and the checks must still see it.

const CTX = { currentYear: 2026, g12Year: 2020 };
type V = Record<string, string>;
const errorsOf = (submitted: V, previous: V) => reviewSave(submitted, previous, CTX).errors;

describe("afterSave", () => {
  it("keeps saved values where the form is blank and takes every filled one", () => {
    expect(afterSave({ degree_ug: "MBBS", branch_id_ug: "" }, { degree_ug: "BTech/BE", branch_id_ug: "CSIT013" }))
      .toEqual({ degree_ug: "MBBS", branch_id_ug: "CSIT013" });
  });
});

describe("clearing one field of a blocked pair", () => {
  const studying = { ug_status: "Studying", current_status: "Studying" };

  it("still blocks MBBS on the saved CS branch", () => {
    const previous = { ...studying, degree_ug: "BTech/BE", branch_id_ug: "CSIT013" };
    expect(errorsOf({ ...studying, degree_ug: "MBBS", branch_id_ug: "" }, previous)).toHaveProperty("degree_ug");
  });

  it("still blocks a 1-year BTech against the saved start year", () => {
    const previous = { ...studying, degree_ug: "BTech/BE", start_year_ug: "2025" };
    const submitted = { ug_status: "Graduated", current_status: "Studying", degree_ug: "BTech/BE", start_year_ug: "", year_of_graduation_ug: "2026" };
    expect(errorsOf(submitted, previous)).toHaveProperty("year_of_graduation_ug");
  });

  it("still blocks PG starting before the saved UG graduation", () => {
    const base = { ug_status: "Graduated", degree_ug: "BTech/BE", start_year_ug: "2020", pg_status: "Studying", degree_pg: "MTech" };
    const previous = { ...base, year_of_graduation_ug: "2024" };
    expect(errorsOf({ ...base, year_of_graduation_ug: "", start_year_pg: "2022" }, previous)).toHaveProperty("start_year_pg");
  });

  it("still blocks Employed against the saved Not Employed", () => {
    const previous = { current_status: "Studying", employment_status: "Not Employed - Seeking Work" };
    expect(errorsOf({ current_status: "Employed", employment_status: "" }, previous)).toHaveProperty("employment_status");
  });

  it("leaves an old record's pair alone when neither field changes", () => {
    const previous = { ...studying, degree_ug: "MBBS", branch_id_ug: "CSIT013" };
    expect(errorsOf({ ...previous, current_status: "Studying" }, previous)).toEqual({});
  });
});

describe("visibleValues", () => {
  it("leaves out values that no longer apply (work after switching to Not Employed)", () => {
    const saved = visibleValues({ employment_status: "Not Employed - Seeking Work", current_org_name: "Infosys", current_ctc: "500" });
    expect(saved).toHaveProperty("employment_status");
    expect(saved).not.toHaveProperty("current_org_name");
    expect(saved).not.toHaveProperty("current_ctc");
  });

  it("keeps an old value whose controlling answer was never filled in", () => {
    expect(visibleValues({ current_org_name: "Infosys" })).toHaveProperty("current_org_name", "Infosys");
  });
});

describe("medical course length", () => {
  it.each(["MBBS", "BAMS", "BHMS", "BNYS", "BVSc"])("asks to confirm a 4-year %s instead of blocking it", (degree) => {
    const v = { ug_status: "Graduated", degree_ug: degree, start_year_ug: "2020", year_of_graduation_ug: "2024" };
    const review = reviewSave(v, {}, CTX);
    expect(review.errors).not.toHaveProperty("year_of_graduation_ug");
    expect(review.warnings.map((w) => w.id)).toContain("ug-duration");
  });
});

describe("old records' spellings", () => {
  it("checks a legacy NO against a Gap year status", () => {
    expect(errorsOf({ did_you_take_a_gap_year: "NO", current_status: "Gap Year" }, {})).toHaveProperty("did_you_take_a_gap_year");
    expect(errorsOf({ did_you_take_a_gap_year: "No", ug_status: "Gap year" }, {})).toHaveProperty("did_you_take_a_gap_year");
  });
});
