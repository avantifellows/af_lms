import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  createCentre,
  checkCentreManagementSchema,
  createCentreOption,
  getCentreList,
  getCentreOptionSets,
  getCentreSearchSuggestions,
  isActiveCentreOptionCode,
  resetCentreSchemaCheckForTests,
  updateCentre,
  updateCentreOption,
} from "./centres";

const mockQuery = vi.mocked(query);

describe("Centre option contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
  });

  it("returns fixed option sets in v1 order with inactive options still readable", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_set_id: "2",
          option_set_code: "type",
          option_set_label: "Centre Type",
          allow_multi: false,
          option_set_sort_order: "1",
          option_id: "21",
          option_code: "coe",
          option_label: "CoE",
          option_sort_order: "2",
          option_is_active: false,
          option_inserted_at: null,
          option_updated_at: null,
        },
      ]);

    const result = await getCentreOptionSets();

    expect(result).toEqual({
      ok: true,
      optionSets: [
        {
          id: 2,
          code: "type",
          label: "Centre Type",
          allowMulti: false,
          sortOrder: 1,
          options: [
            {
              id: 21,
              optionSetCode: "type",
              code: "coe",
              label: "CoE",
              sortOrder: 2,
              isActive: false,
              insertedAt: "",
              updatedAt: "",
            },
          ],
        },
      ],
    });
  });

  it("creates an option in a fixed option set with a confirmed immutable code", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_id: "31",
          option_set_code: "category",
          option_code: "residential",
          option_label: "Residential",
          option_sort_order: "7",
          option_is_active: true,
          option_inserted_at: "2026-01-03T00:00:00.000Z",
          option_updated_at: "2026-01-03T00:00:00.000Z",
        },
      ]);

    const result = await createCentreOption({
      body: {
        option_set_code: "category",
        code: "residential",
        label: "Residential",
        sort_order: 7,
        is_active: true,
      },
    });

    expect(result).toEqual({
      ok: true,
      option: {
        id: 31,
        optionSetCode: "category",
        code: "residential",
        label: "Residential",
        sortOrder: 7,
        isActive: true,
        insertedAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    });
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("INSERT INTO centre_options"), [
      "category",
      "residential",
      "Residential",
      7,
      true,
    ]);
  });

  it("returns a controlled conflict when creating a duplicate option code", async () => {
    const duplicateError = new Error("duplicate key value violates unique constraint");
    Object.assign(duplicateError, { code: "23505" });
    mockQuery.mockResolvedValueOnce([]).mockRejectedValueOnce(duplicateError);

    const result = await createCentreOption({
      body: {
        option_set_code: "type",
        code: "coe",
        label: "CoE",
        sort_order: 1,
        is_active: true,
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Centre option code already exists in this option set",
    });
  });

  it("rejects patch payloads that try to change option code or option set", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await updateCentreOption({
      id: 31,
      body: {
        code: "changed",
        option_set_code: "type",
        label: "Changed",
        sort_order: 2,
        is_active: true,
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "Invalid Centre option edit payload",
      fields: {
        code: "Option code is read-only",
        option_set_code: "Option set is read-only",
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("updates only editable option fields", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_id: "31",
          option_set_code: "category",
          option_code: "residential",
          option_label: "Residential Updated",
          option_sort_order: "9",
          option_is_active: false,
          option_inserted_at: "2026-01-03T00:00:00.000Z",
          option_updated_at: "2026-01-04T00:00:00.000Z",
        },
      ]);

    const result = await updateCentreOption({
      id: 31,
      body: {
        label: "Residential Updated",
        sort_order: 9,
        is_active: false,
      },
    });

    expect(result).toEqual({
      ok: true,
      option: {
        id: 31,
        optionSetCode: "category",
        code: "residential",
        label: "Residential Updated",
        sortOrder: 9,
        isActive: false,
        insertedAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    });
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("UPDATE centre_options"), [
      31,
      "Residential Updated",
      9,
      false,
    ]);
  });

  it("exposes active-only option-code checks for later Centre mutations", () => {
    const optionSets = [
      {
        id: 1,
        code: "type" as const,
        label: "Centre Type",
        allowMulti: false,
        sortOrder: 1,
        options: [
          {
            id: 11,
            optionSetCode: "type" as const,
            code: "coe",
            label: "CoE",
            sortOrder: 1,
            isActive: true,
            insertedAt: "",
            updatedAt: "",
          },
          {
            id: 12,
            optionSetCode: "type" as const,
            code: "old",
            label: "Old",
            sortOrder: 2,
            isActive: false,
            insertedAt: "",
            updatedAt: "",
          },
        ],
      },
    ];

    expect(isActiveCentreOptionCode(optionSets, "type", "coe")).toBe(true);
    expect(isActiveCentreOptionCode(optionSets, "type", "old")).toBe(false);
  });
});

describe("Centre schema contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
  });

  it("requires the Centre Exam Track mapping table", async () => {
    mockQuery.mockResolvedValueOnce([]);

    await expect(checkCentreManagementSchema()).resolves.toEqual({ ok: true });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual(
      expect.arrayContaining([
        "centre_exam_tracks",
        "centre_id",
        "grade_id",
        "exam_track_code",
      ])
    );
  });
});

describe("Centre grid contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCentreSchemaCheckForTests();
  });

  it("lists paginated Centres with School display fields and resolved option labels", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "91",
          name: "JNV Pune CoE",
          school_id: "44",
          type_code: "coe",
          type_label: "CoE",
          type_is_active: false,
          category_code: "cat_1_coe",
          category_label: "Cat 1 CoE",
          category_is_active: true,
          sub_category_code: null,
          sub_category_label: null,
          sub_category_is_active: null,
          grade_11_exam_track_codes: ["jee_main", "jee_advanced"],
          grade_12_exam_track_codes: ["neet"],
          is_physical: true,
          is_active: true,
          program_id: "1",
          program_name: "JNV CoE",
          inserted_at: "2026-01-05T00:00:00.000Z",
          updated_at: "2026-01-06T00:00:00.000Z",
          school_name: "JNV Pune",
          school_code: "PN01",
          school_udise_code: "27250100101",
          school_region: "West",
          school_state: "Maharashtra",
          school_district: "Pune",
          total_count: "1",
          active_count: "1",
          linked_count: "1",
          physical_count: "1",
        },
      ]);

    const result = await getCentreList({
      searchParams: { page: "1", limit: "25", search: "pune" },
    });

    expect(result).toEqual({
      ok: true,
      filters: {
        search: "pune",
        searchTerms: [],
        active: "all",
        schoolLink: "all",
        typeCode: null,
        categoryCode: null,
        subCategoryCode: null,
        isPhysical: "all",
      },
      rows: [
        {
          id: 91,
          name: "JNV Pune CoE",
          schoolId: 44,
          typeCode: "coe",
          typeLabel: "CoE",
          typeOptionActive: false,
          categoryCode: "cat_1_coe",
          categoryLabel: "Cat 1 CoE",
          categoryOptionActive: true,
          subCategoryCode: null,
          subCategoryLabel: null,
          subCategoryOptionActive: null,
          grade11ExamTrackCodes: ["jee_main", "jee_advanced"],
          grade12ExamTrackCodes: ["neet"],
          isPhysical: true,
          isActive: true,
          programId: 1,
          programName: "JNV CoE",
          insertedAt: "2026-01-05T00:00:00.000Z",
          updatedAt: "2026-01-06T00:00:00.000Z",
          school: {
            id: 44,
            name: "JNV Pune",
            code: "PN01",
            udiseCode: "27250100101",
            region: "West",
            state: "Maharashtra",
            district: "Pune",
          },
        },
      ],
      summary: {
        totalCentres: 1,
        activeCentres: 1,
        linkedCentres: 1,
        physicalCentres: 1,
      },
      pagination: {
        page: 1,
        limit: 25,
        totalRows: 1,
        totalPages: 1,
      },
    });
  });

  it("returns fast Centre search suggestions across Centre and linked School fields", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          kind: "centre_name",
          value: "JNV Barwani",
          label: "JNV Barwani",
          detail: "Centre name",
        },
        {
          kind: "school_code",
          value: "54059",
          label: "54059",
          detail: "JNV Barwani",
        },
      ]);

    const result = await getCentreSearchSuggestions({ search: "bar", limit: 8 });

    expect(result).toEqual({
      ok: true,
      suggestions: [
        {
          kind: "centre_name",
          value: "JNV Barwani",
          label: "JNV Barwani",
          detail: "Centre name",
        },
        {
          kind: "school_code",
          value: "54059",
          label: "54059",
          detail: "JNV Barwani",
        },
      ],
    });
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("WITH candidates AS"),
      ["%bar%", "bar", "bar%", 8]
    );
  });

  it("creates Centres only with active option codes and a valid optional School", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_set_id: "1",
          option_set_code: "type",
          option_set_label: "Centre Type",
          allow_multi: false,
          option_set_sort_order: "1",
          option_id: "11",
          option_code: "coe",
          option_label: "CoE",
          option_sort_order: "1",
          option_is_active: true,
          option_inserted_at: null,
          option_updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ id: "44" }])
      .mockResolvedValueOnce([
        {
          id: "92",
          name: "New Centre",
          school_id: "44",
          type_code: "coe",
          type_label: "CoE",
          type_is_active: true,
          category_code: null,
          category_label: null,
          category_is_active: null,
          sub_category_code: null,
          sub_category_label: null,
          sub_category_is_active: null,
          grade_11_exam_track_codes: ["jee_main", "jee_advanced"],
          grade_12_exam_track_codes: ["neet"],
          is_physical: false,
          is_active: true,
          inserted_at: "2026-01-07T00:00:00.000Z",
          updated_at: "2026-01-07T00:00:00.000Z",
          school_name: "JNV Pune",
          school_code: "PN01",
          school_udise_code: "27250100101",
          school_region: "West",
          school_state: "Maharashtra",
          school_district: "Pune",
          total_count: "1",
        },
      ]);

    const result = await createCentre({
      body: {
        name: "New Centre",
        school_id: 44,
        type_code: "coe",
        category_code: null,
        sub_category_code: null,
        grade_11_exam_track_codes: ["jee_main", "jee_advanced"],
        grade_12_exam_track_codes: ["neet"],
        is_physical: false,
        is_active: true,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      centre: {
        id: 92,
        name: "New Centre",
        schoolId: 44,
        typeCode: "coe",
        grade11ExamTrackCodes: ["jee_main", "jee_advanced"],
        grade12ExamTrackCodes: ["neet"],
        isPhysical: false,
        isActive: true,
      },
    });
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("INSERT INTO centres"), [
      "New Centre",
      44,
      "coe",
      null,
      null,
      false,
      true,
      null,
      ["jee_main", "jee_advanced"],
      ["neet"],
    ]);
    expect(mockQuery.mock.calls.at(-1)?.[0]).toContain("DELETE FROM centre_exam_tracks");
    expect(mockQuery.mock.calls.at(-1)?.[0]).toContain("ON CONFLICT");
  });

  it("updates Centres while allowing unchanged inactive options to remain", async () => {
    const existingCentreRow = {
      id: "93",
      name: "Legacy Centre",
      school_id: null,
      type_code: "legacy",
      type_label: "Legacy",
      type_is_active: false,
      category_code: null,
      category_label: null,
      category_is_active: null,
      sub_category_code: null,
      sub_category_label: null,
      sub_category_is_active: null,
      is_physical: true,
      is_active: true,
      inserted_at: "2026-01-08T00:00:00.000Z",
      updated_at: "2026-01-08T00:00:00.000Z",
      school_name: null,
      school_code: null,
      school_udise_code: null,
      school_region: null,
      school_state: null,
      school_district: null,
      total_count: "1",
    };
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingCentreRow])
      .mockResolvedValueOnce([
        {
          option_set_id: "1",
          option_set_code: "type",
          option_set_label: "Centre Type",
          allow_multi: false,
          option_set_sort_order: "1",
          option_id: "12",
          option_code: "legacy",
          option_label: "Legacy",
          option_sort_order: "9",
          option_is_active: false,
          option_inserted_at: null,
          option_updated_at: null,
        },
      ])
      .mockResolvedValueOnce([{ ...existingCentreRow, name: "Legacy Centre Updated", is_active: false }]);

    const result = await updateCentre({
      id: 93,
      body: {
        name: "Legacy Centre Updated",
        type_code: "legacy",
        is_active: false,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      centre: {
        id: 93,
        name: "Legacy Centre Updated",
        typeCode: "legacy",
        typeOptionActive: false,
        isActive: false,
      },
    });
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("UPDATE centres"), [
      93,
      "Legacy Centre Updated",
      null,
      "legacy",
      null,
      null,
      true,
      false,
      null,
      [],
      [],
    ]);
    expect(mockQuery.mock.calls.at(-1)?.[0]).toContain("DELETE FROM centre_exam_tracks");
    expect(mockQuery.mock.calls.at(-1)?.[0]).toContain("NOT EXISTS");
  });

  it("rejects non-string single-select option codes on Centre updates", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "93",
          name: "Legacy Centre",
          school_id: null,
          type_code: "legacy",
          type_label: "Legacy",
          type_is_active: false,
          category_code: null,
          category_label: null,
          category_is_active: null,
          sub_category_code: null,
          sub_category_label: null,
          sub_category_is_active: null,
          is_physical: true,
          is_active: true,
          inserted_at: "2026-01-08T00:00:00.000Z",
          updated_at: "2026-01-08T00:00:00.000Z",
          school_name: null,
          school_code: null,
          school_udise_code: null,
          school_region: null,
          school_state: null,
          school_district: null,
          total_count: "1",
        },
      ]);

    const result = await updateCentre({
      id: 93,
      body: {
        type_code: 123,
        category_code: ["school"],
        sub_category_code: { code: "coe" },
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "Invalid Centre payload",
      fields: {
        type_code: "Centre option code must be a string or null",
        category_code: "Centre option code must be a string or null",
        sub_category_code: "Centre option code must be a string or null",
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown, inactive, and wrong-set options for new Centre selections", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          option_set_id: "1",
          option_set_code: "type",
          option_set_label: "Centre Type",
          allow_multi: false,
          option_set_sort_order: "1",
          option_id: "11",
          option_code: "coe",
          option_label: "CoE",
          option_sort_order: "1",
          option_is_active: true,
          option_inserted_at: null,
          option_updated_at: null,
        },
        {
          option_set_id: "2",
          option_set_code: "category",
          option_set_label: "Centre Category",
          allow_multi: false,
          option_set_sort_order: "2",
          option_id: "21",
          option_code: "cat_1_coe",
          option_label: "Cat 1 CoE",
          option_sort_order: "1",
          option_is_active: true,
          option_inserted_at: null,
          option_updated_at: null,
        },
      ]);

    const result = await createCentre({
      body: {
        name: "Invalid Centre",
        school_id: null,
        type_code: "cat_1_coe",
        category_code: null,
        sub_category_code: "missing",
        is_physical: true,
        is_active: true,
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "Invalid Centre payload",
      fields: {
        type_code: "Centre type_code must be an active type option",
        sub_category_code:
          "Centre sub_category_code must be an active sub_category option",
      },
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
