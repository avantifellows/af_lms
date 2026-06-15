import { describe, expect, it } from "vitest";

import {
  CENTRE_OPTION_SEED_OPTIONS,
  CENTRE_OPTION_SEED_SETS,
  runCentreOptionSeed,
  type CentreOptionSeedDb,
} from "./centre-option-seed";

class FakeSeedDb implements CentreOptionSeedDb {
  readonly calls: Array<{ sql: string; params?: unknown[] }> = [];

  constructor(private readonly responses: unknown[][]) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.calls.push({ sql, params });
    return (this.responses.shift() ?? []) as T[];
  }
}

describe("Centre option seed script", () => {
  it("defaults to a dry-run plan without writing Centre option rows", async () => {
    const db = new FakeSeedDb([[], []]);

    const result = await runCentreOptionSeed({ db });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("dry-run");
    expect(result.counts.optionSets.created).toBe(4);
    expect(result.counts.options.created).toBeGreaterThan(0);
    expect(result.changes.optionSets.created.map((change) => change.code)).toEqual([
      "type",
      "category",
      "sub_category",
      "stream",
    ]);
    expect(
      db.calls.some((call) => /\b(insert|update|delete)\b/i.test(call.sql))
    ).toBe(false);
  });

  it("applies seed-managed rows while preserving admin-created options", async () => {
    const db = new FakeSeedDb([
      [],
      [
        {
          option_set_id: "1",
          option_set_code: "type",
          option_set_label: "Centre Type",
          allow_multi: false,
          option_set_sort_order: "1",
          option_id: "11",
          option_code: "coe",
          option_label: "Old CoE",
          option_sort_order: "9",
          option_is_active: false,
        },
        {
          option_set_id: "1",
          option_set_code: "type",
          option_set_label: "Centre Type",
          allow_multi: false,
          option_set_sort_order: "1",
          option_id: "12",
          option_code: "custom_admin_type",
          option_label: "Custom Admin Type",
          option_sort_order: "99",
          option_is_active: true,
        },
      ],
    ]);

    const result = await runCentreOptionSeed({ mode: "apply", db });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("apply");
    expect(result.counts.optionSets.created).toBe(3);
    expect(result.counts.optionSets.unchanged).toBe(1);
    expect(result.counts.options.created).toBeGreaterThan(0);
    expect(result.counts.options.updated).toBe(1);
    expect(result.changes.options.updated).toContainEqual({
      optionSetCode: "type",
      code: "coe",
      label: "CoE",
      reason: "seed-managed metadata differs",
    });
    expect(result.changes.options.skipped).toEqual([
      {
        optionSetCode: "type",
        code: "custom_admin_type",
        label: "Custom Admin Type",
        reason: "not seed-managed",
      },
    ]);

    const sql = db.calls.map((call) => call.sql).join("\n");
    expect(sql).toContain("INSERT INTO centre_option_sets");
    expect(sql).toContain("INSERT INTO centre_options");
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bSET\s+code\b/i);
    expect(sql).not.toMatch(/\bSET\s+option_set_id\b/i);
  });

  it("fails clearly when Centre option tables are missing", async () => {
    const db = new FakeSeedDb([
      [{ table_name: "centre_option_sets", column_name: "code" }],
    ]);

    const result = await runCentreOptionSeed({ mode: "apply", db });

    expect(result).toMatchObject({
      ok: false,
      mode: "apply",
      error:
        "Centre option tables are unavailable. Run the db-service Centre management schema migration before seeding options.",
      details: ["centre_option_sets.code"],
    });
    expect(db.calls).toHaveLength(1);
  });

  it("reports an apply rerun as unchanged when seed rows already match", async () => {
    const existingRows = CENTRE_OPTION_SEED_OPTIONS.map((option, index) => {
      const optionSet = CENTRE_OPTION_SEED_SETS.find(
        (set) => set.code === option.optionSetCode
      );

      return {
        option_set_id:
          CENTRE_OPTION_SEED_SETS.findIndex(
            (set) => set.code === option.optionSetCode
          ) + 1,
        option_set_code: option.optionSetCode,
        option_set_label: optionSet?.label ?? "",
        allow_multi: optionSet?.allowMulti ?? false,
        option_set_sort_order: optionSet?.sortOrder ?? 0,
        option_id: index + 11,
        option_code: option.code,
        option_label: option.label,
        option_sort_order: option.sortOrder,
        option_is_active: option.isActive,
      };
    });
    const db = new FakeSeedDb([[], existingRows]);

    const result = await runCentreOptionSeed({ mode: "apply", db });

    expect(result.counts.optionSets).toEqual({
      created: 0,
      updated: 0,
      unchanged: 4,
      skipped: 0,
    });
    expect(result.counts.options).toEqual({
      created: 0,
      updated: 0,
      unchanged: CENTRE_OPTION_SEED_OPTIONS.length,
      skipped: 0,
    });
  });
});
