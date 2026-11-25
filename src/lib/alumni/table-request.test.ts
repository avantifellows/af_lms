import { describe, expect, it } from "vitest";
import { readTableRequest } from "./table-request";

const read = (qs: string) => readTableRequest(`http://localhost/api/alumni/table?${qs}`);

describe("readTableRequest", () => {
  it("reads every filter", () => {
    expect(read("school=59525&year=2024-2025,2025-2026&record=added&q=ram&college_id_ug=missing&ug_status=filled&page=3&refs=1")).toEqual({
      school: "59525",
      filters: {
        years: ["2024-2025", "2025-2026"],
        record: "added",
        fields: { college_id_ug: "missing", ug_status: "filled" },
        q: "ram",
      },
      page: 3,
      refs: true,
    });
  });

  it("drops what it doesn't recognise and defaults the page", () => {
    expect(read("school=%20&year=2024,abcd-efgh&record=maybe&college_id_ug=sometimes&not_a_field=missing&page=-2")).toEqual({
      school: undefined,
      filters: { years: [], record: undefined, fields: {}, q: "" },
      page: 1,
      refs: false,
    });
    expect(read("page=1.5").page).toBe(1);
  });

  it("caps the search at 100 characters", () => {
    expect(read(`q=${"a".repeat(150)}`).filters.q).toHaveLength(100);
  });
});
