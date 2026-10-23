import { describe, expect, it } from "vitest";
import { ALUMNI_SECTIONS, isEmployed, isFieldShown, isFieldStale, type Values } from "./fields";

const shown = (v: Values) =>
  ALUMNI_SECTIONS.flatMap((s) => s.fields.filter((f) => isFieldShown(s, f, v)).map((f) => f.column));
const stale = (v: Values) =>
  ALUMNI_SECTIONS.flatMap((s) => s.fields.filter((f) => isFieldStale(s, f, v)).map((f) => f.column));

describe("which fields the form shows", () => {
  it("starts with only the status questions and the optional extras", () => {
    const fields = shown({});
    expect(fields).toContain("ug_status");
    expect(fields).toContain("linkedin_profile_link");
    expect(fields).not.toContain("college_id_ug");
    expect(fields).not.toContain("pg_status");
    expect(fields).not.toContain("current_org_name");
  });

  it("opens UG while studying, adds graduation year and the PG question once graduated", () => {
    expect(shown({ ug_status: "Studying" })).toContain("college_id_ug");
    expect(shown({ ug_status: "Studying" })).not.toContain("year_of_graduation_ug");
    expect(shown({ ug_status: "Graduated" })).toEqual(expect.arrayContaining(["year_of_graduation_ug", "pg_status"]));
  });

  it("opens PG details only while studying / graduated in PG", () => {
    expect(shown({ ug_status: "Graduated", pg_status: "Not Applying" })).not.toContain("college_id_pg");
    expect(shown({ ug_status: "Graduated", pg_status: "Studying" })).toContain("college_id_pg");
    expect(shown({ ug_status: "Graduated", pg_status: "Graduated" })).toContain("year_of_graduation_pg");
  });

  it("opens Work only when employed, with starting CTC only after UG", () => {
    expect(isEmployed({ employment_status: "Employed - Internship" })).toBe(true);
    expect(shown({ employment_status: "Not Employed" })).not.toContain("current_org_name");
    expect(shown({ employment_status: "Employed - Full-time", ug_status: "Studying" })).not.toContain("starting_ctc_ug_range");
    expect(shown({ employment_status: "Employed - Full-time", ug_status: "Graduated" })).toContain("starting_ctc_ug_range");
  });

  it("asks the gap-year reason when they took one or UG is Gap Year", () => {
    expect(shown({ did_you_take_a_gap_year: "Yes" })).toContain("why_did_you_take_a_gap_year");
    expect(shown({ ug_status: "Gap Year" })).toContain("why_did_you_take_a_gap_year");
  });

  it("always shows a field that already holds a value", () => {
    expect(shown({ college_id_pg: "C-1" })).toContain("college_id_pg");
  });
});

describe("stale values", () => {
  const oldUg = { college_id_ug: "C-19808", branch_id_ug: "ELEC067", degree_ug: "BTech/BE" };

  it("doesn't flag an old record whose status is still blank", () => {
    expect(stale(oldUg)).toEqual([]);
  });

  it("flags values that no longer fit once the status is set", () => {
    expect(stale({ ...oldUg, ug_status: "Gap Year" })).toEqual(expect.arrayContaining(["college_id_ug", "degree_ug"]));
    expect(stale({ ...oldUg, ug_status: "Studying" })).toEqual([]);
  });

  it("never flags an empty field", () => {
    expect(stale({ ug_status: "Gap Year" })).toEqual([]);
  });
});
