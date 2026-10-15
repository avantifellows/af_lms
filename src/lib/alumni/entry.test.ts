import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { getAlumnusContext, getEntryContext } from "./entry";

const mockQuery = vi.mocked(query);

/** Answer each query by what it reads, so the order of calls doesn't matter. */
function answer(rows: { owner?: object[]; student?: object[]; alumni?: object[]; meta?: object[]; cohort?: object[] }) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT s.user_id FROM alumni a")) return (rows.owner ?? []) as never;
    if (sql.includes('FROM "user" u JOIN student s')) return (rows.student ?? []) as never;
    // Checked before the alumni lookup: the pass-out query also mentions "FROM alumni a".
    if (sql.includes("cohort_flagged")) return (rows.cohort ?? []) as never;
    if (sql.includes("FROM alumni a")) return (rows.alumni ?? []) as never;
    if (sql.includes("FROM (SELECT 1) one")) return (rows.meta ?? []) as never;
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  });
}

const STUDENT = {
  user_id: "86655",
  student_pk: "86544",
  afid: "2632401171",
  user_first_name: "Ampoli",
  user_last_name: "Ram  Charan ",
  user_gender: "Female",
  user_date_of_birth: null,
  student_physically_handicapped: "FALSE",
  student_g12_graduating_year: null,
};

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getEntryContext", () => {
  it("returns null for an unknown user", async () => {
    answer({});
    expect(await getEntryContext("1")).toBeNull();
  });

  it("loads an existing alumnus for editing, with college/branch as codes", async () => {
    answer({
      student: [STUDENT],
      alumni: [{
        id: 8340, ug_status: "Studying", degree_ug: "BTech/BE", start_year_ug: 2026, current_ctc: null,
        if_avanti_was_not_your_only_source_of_test_prep_coaching_then_w: "Self study",
        college_id_ug: 40947, college_code_ug: "C-19609", college_name_ug: "Nalla Malla Reddy Engineering College",
        branch_id_ug: 224, branch_code_ug: "CSIT057", branch_name_ug: "Computer Science and Engineering",
      }],
      meta: [{ program: "JNV CoE", school_code: "59525", school_name: "JNV Adilabad", cohort_year: "2025-2026" }],
    });

    const ctx = await getEntryContext("86655");

    expect(ctx).toMatchObject({
      kind: "edit",
      ids: { enrollmentUserId: "86655", studentId: "86544", alumniId: "8340" },
      name: "Ampoli Ram Charan",
      afid: "2632401171",
      program: "JNV CoE",
      school: "JNV Adilabad",
      schoolCode: "59525",
      cohortYear: "2025-2026",
    });
    expect(ctx!.alumni).toMatchObject({
      ug_status: "Studying",
      degree_ug: "BTech/BE",
      start_year_ug: "2026",
      current_ctc: "",
      college_id_ug: "C-19609",
      branch_id_ug: "CSIT057",
      college_id_pg: "",
      // Postgres cuts this column name at 63 characters; the form uses the full name.
      if_avanti_was_not_your_only_source_of_test_prep_coaching_then_what_other_resources_did_you_opt_for: "Self study",
    });
    expect(ctx!.codeNames).toMatchObject({ college_id_ug: "Nalla Malla Reddy Engineering College", branch_id_ug: "Computer Science and Engineering" });
    expect(ctx!.profile).toMatchObject({ user_gender: "Female", user_date_of_birth: "", student_physically_handicapped: "FALSE" });
  });

  it("falls back to 'none' when an alumnus has no School", async () => {
    answer({ student: [STUDENT], alumni: [{ id: 1 }], meta: [{ program: null, school_code: null, school_name: null, cohort_year: null }] });
    expect(await getEntryContext("86655")).toMatchObject({ kind: "edit", schoolCode: "none", school: "", program: "" });
  });

  it("loads a pass-out with no alumni row as a new entry, Class 12 year from the pass-out year", async () => {
    answer({
      student: [STUDENT],
      cohort: [{ program: "Punjab Nodal", passout_year: "2025-2026", school_code: "3140103005", school_name: "RSMS Bathinda", status: null }],
    });

    const ctx = await getEntryContext("86655");

    expect(ctx).toMatchObject({
      kind: "new",
      ids: { alumniId: "" },
      program: "Punjab Nodal",
      school: "RSMS Bathinda",
      schoolCode: "3140103005",
      cohortYear: "2025-2026",
      alumni: {},
    });
    expect(ctx!.profile.student_g12_graduating_year).toBe("2026");
  });

  it("returns null for someone who is neither an alumnus nor a pass-out", async () => {
    answer({ student: [STUDENT] });
    expect(await getEntryContext("86655")).toBeNull();
  });
});

describe("getAlumnusContext", () => {
  const ALUMNUS = [{ id: 8340, ug_status: "Studying" }];

  it("loads the alumnus by alumni.id", async () => {
    answer({ owner: [{ user_id: "86655" }], student: [STUDENT], alumni: ALUMNUS });
    const context = await getAlumnusContext("8340");
    expect(context).toMatchObject({ kind: "edit", ids: { alumniId: "8340", enrollmentUserId: "86655" } });
    expect(mockQuery.mock.calls[0][1]).toEqual(["8340"]);
  });

  it("returns null for an unknown alumni id", async () => {
    answer({});
    expect(await getAlumnusContext("1")).toBeNull();
  });

  it("returns null when the student's record is a different alumni row", async () => {
    answer({ owner: [{ user_id: "86655" }], student: [STUDENT], alumni: [{ id: 9999 }] });
    expect(await getAlumnusContext("8340")).toBeNull();
  });
});
