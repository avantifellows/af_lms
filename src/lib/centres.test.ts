import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import {
  createCentreOption,
  getCentreOptionSets,
  isActiveCentreOptionCode,
  resetCentreSchemaCheckForTests,
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
          option_set_id: "1",
          option_set_code: "stream",
          option_set_label: "Centre Stream",
          allow_multi: true,
          option_set_sort_order: "4",
          option_id: "12",
          option_code: "jee",
          option_label: "JEE",
          option_sort_order: "1",
          option_is_active: true,
          option_inserted_at: "2026-01-01T00:00:00.000Z",
          option_updated_at: "2026-01-02T00:00:00.000Z",
        },
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
        {
          id: 1,
          code: "stream",
          label: "Centre Stream",
          allowMulti: true,
          sortOrder: 4,
          options: [
            {
              id: 12,
              optionSetCode: "stream",
              code: "jee",
              label: "JEE",
              sortOrder: 1,
              isActive: true,
              insertedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
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
        option_set_code: "stream",
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
    expect(isActiveCentreOptionCode(optionSets, "stream", "coe")).toBe(false);
  });
});
