import { query } from "./db";
import type { CentreOptionSetCode } from "./centres";

export type CentreOptionSeedMode = "dry-run" | "apply";

export interface CentreOptionSeedDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CentreOptionSeedChange {
  code: string;
  label: string;
  optionSetCode?: CentreOptionSetCode;
  reason: string;
}

export interface CentreOptionSeedCounts {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

export interface CentreOptionSeedReport {
  ok: boolean;
  mode: CentreOptionSeedMode;
  error?: string;
  details?: string[];
  counts: {
    optionSets: CentreOptionSeedCounts;
    options: CentreOptionSeedCounts;
  };
  changes: {
    optionSets: {
      created: CentreOptionSeedChange[];
      updated: CentreOptionSeedChange[];
      unchanged: CentreOptionSeedChange[];
      skipped: CentreOptionSeedChange[];
    };
    options: {
      created: CentreOptionSeedChange[];
      updated: CentreOptionSeedChange[];
      unchanged: CentreOptionSeedChange[];
      skipped: CentreOptionSeedChange[];
    };
  };
}

interface SeedOptionSet {
  code: CentreOptionSetCode;
  label: string;
  allowMulti: boolean;
  sortOrder: number;
}

interface SeedOption {
  optionSetCode: CentreOptionSetCode;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

interface ExistingOptionSetRow {
  option_set_id: string | number;
  option_set_code: string;
  option_set_label: string | null;
  allow_multi: boolean | string | null;
  option_set_sort_order: string | number | null;
  option_id: string | number | null;
  option_code: string | null;
  option_label: string | null;
  option_sort_order: string | number | null;
  option_is_active: boolean | string | null;
}

interface MissingColumnRow {
  table_name: string;
  column_name: string;
}

interface ExistingSeedOption {
  optionSetCode: CentreOptionSetCode;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "centre_option_sets", column: "id" },
  { table: "centre_option_sets", column: "code" },
  { table: "centre_option_sets", column: "label" },
  { table: "centre_option_sets", column: "allow_multi" },
  { table: "centre_option_sets", column: "sort_order" },
  { table: "centre_options", column: "id" },
  { table: "centre_options", column: "option_set_id" },
  { table: "centre_options", column: "code" },
  { table: "centre_options", column: "label" },
  { table: "centre_options", column: "sort_order" },
  { table: "centre_options", column: "is_active" },
];

export const CENTRE_OPTION_SEED_SETS: SeedOptionSet[] = [
  { code: "type", label: "Centre Type", allowMulti: false, sortOrder: 1 },
  { code: "category", label: "Centre Category", allowMulti: false, sortOrder: 2 },
  {
    code: "sub_category",
    label: "Centre Sub-category",
    allowMulti: false,
    sortOrder: 3,
  },
  { code: "stream", label: "Centre Stream", allowMulti: true, sortOrder: 4 },
];

export const CENTRE_OPTION_SEED_OPTIONS: SeedOption[] = [
  {
    optionSetCode: "type",
    code: "coe",
    label: "CoE",
    sortOrder: 1,
    isActive: true,
  },
  {
    optionSetCode: "type",
    code: "nodal",
    label: "Nodal",
    sortOrder: 2,
    isActive: true,
  },
  {
    optionSetCode: "category",
    code: "cat_1_coe",
    label: "Cat 1 CoE",
    sortOrder: 1,
    isActive: true,
  },
  {
    optionSetCode: "category",
    code: "cat_2_coe",
    label: "Cat 2 CoE",
    sortOrder: 2,
    isActive: true,
  },
  {
    optionSetCode: "category",
    code: "foundation",
    label: "Foundation",
    sortOrder: 3,
    isActive: true,
  },
  {
    optionSetCode: "category",
    code: "nodal",
    label: "Nodal",
    sortOrder: 4,
    isActive: true,
  },
  {
    optionSetCode: "sub_category",
    code: "cat_2_coe",
    label: "Cat 2 CoE",
    sortOrder: 1,
    isActive: true,
  },
  {
    optionSetCode: "sub_category",
    code: "coaching_center",
    label: "Coaching center",
    sortOrder: 2,
    isActive: true,
  },
  {
    optionSetCode: "sub_category",
    code: "regional_coe",
    label: "Regional CoE",
    sortOrder: 3,
    isActive: true,
  },
  {
    optionSetCode: "sub_category",
    code: "state_coe",
    label: "State CoE",
    sortOrder: 4,
    isActive: true,
  },
  {
    optionSetCode: "sub_category",
    code: "nodal",
    label: "Nodal",
    sortOrder: 5,
    isActive: true,
  },
  {
    optionSetCode: "stream",
    code: "jee",
    label: "JEE",
    sortOrder: 1,
    isActive: true,
  },
  {
    optionSetCode: "stream",
    code: "neet",
    label: "NEET",
    sortOrder: 2,
    isActive: true,
  },
  {
    optionSetCode: "stream",
    code: "math_foundation",
    label: "Math Foundation",
    sortOrder: 3,
    isActive: true,
  },
];

const defaultDb: CentreOptionSeedDb = { query };

export async function runCentreOptionSeed(params: {
  mode?: CentreOptionSeedMode;
  db?: CentreOptionSeedDb;
}): Promise<CentreOptionSeedReport> {
  const mode = params.mode ?? "dry-run";
  const db = params.db ?? defaultDb;
  const report = emptyReport(mode);
  const schema = await checkSeedSchema(db);

  if (!schema.ok) {
    return {
      ...report,
      ok: false,
      error:
        "Centre option tables are unavailable. Run the db-service Centre management schema migration before seeding options.",
      details: schema.details,
    };
  }

  const existing = await loadExistingSeedState(db);
  const seedOptionKeys = new Set(
    CENTRE_OPTION_SEED_OPTIONS.map((seedOption) =>
      optionKey(seedOption.optionSetCode, seedOption.code)
    )
  );

  for (const seedSet of CENTRE_OPTION_SEED_SETS) {
    const existingSet = existing.optionSets.get(seedSet.code);
    if (!existingSet) {
      report.changes.optionSets.created.push({
        code: seedSet.code,
        label: seedSet.label,
        reason: "missing fixed option set",
      });
      report.counts.optionSets.created += 1;
      continue;
    }

    if (
      existingSet.label !== seedSet.label ||
      existingSet.allowMulti !== seedSet.allowMulti ||
      existingSet.sortOrder !== seedSet.sortOrder
    ) {
      report.changes.optionSets.updated.push({
        code: seedSet.code,
        label: seedSet.label,
        reason: "seed-managed metadata differs",
      });
      report.counts.optionSets.updated += 1;
    } else {
      report.changes.optionSets.unchanged.push({
        code: seedSet.code,
        label: seedSet.label,
        reason: "already matches seed",
      });
      report.counts.optionSets.unchanged += 1;
    }
  }

  for (const seedOption of CENTRE_OPTION_SEED_OPTIONS) {
    const key = optionKey(seedOption.optionSetCode, seedOption.code);
    const existingOption = existing.options.get(key);
    if (!existingOption) {
      report.changes.options.created.push({
        optionSetCode: seedOption.optionSetCode,
        code: seedOption.code,
        label: seedOption.label,
        reason: "missing seed-managed option",
      });
      report.counts.options.created += 1;
      continue;
    }

    if (
      existingOption.label !== seedOption.label ||
      existingOption.sortOrder !== seedOption.sortOrder ||
      existingOption.isActive !== seedOption.isActive
    ) {
      report.changes.options.updated.push({
        optionSetCode: seedOption.optionSetCode,
        code: seedOption.code,
        label: seedOption.label,
        reason: "seed-managed metadata differs",
      });
      report.counts.options.updated += 1;
    } else {
      report.changes.options.unchanged.push({
        optionSetCode: seedOption.optionSetCode,
        code: seedOption.code,
        label: seedOption.label,
        reason: "already matches seed",
      });
      report.counts.options.unchanged += 1;
    }
  }

  for (const existingOption of existing.options.values()) {
    if (seedOptionKeys.has(optionKey(existingOption.optionSetCode, existingOption.code))) {
      continue;
    }

    report.changes.options.skipped.push({
      optionSetCode: existingOption.optionSetCode,
      code: existingOption.code,
      label: existingOption.label,
      reason: "not seed-managed",
    });
    report.counts.options.skipped += 1;
  }

  if (mode === "apply") {
    await applySeedOptionSets(db);
    await applySeedOptions(db);
  }

  return report;
}

async function checkSeedSchema(
  db: CentreOptionSeedDb
): Promise<{ ok: true } | { ok: false; details: string[] }> {
  const values = REQUIRED_COLUMNS.map(
    (_column, index) => `($${index * 2 + 1}, $${index * 2 + 2})`
  ).join(", ");
  const params = REQUIRED_COLUMNS.flatMap(({ table, column }) => [
    table,
    column,
  ]);
  const rows = await db.query<MissingColumnRow>(
    `WITH required(table_name, column_name) AS (VALUES ${values})
     SELECT required.table_name, required.column_name
     FROM required
     LEFT JOIN information_schema.columns cols
       ON cols.table_schema = 'public'
      AND cols.table_name = required.table_name
      AND cols.column_name = required.column_name
     WHERE cols.column_name IS NULL
     ORDER BY required.table_name, required.column_name`,
    params
  );

  if (rows.length === 0) return { ok: true };
  return {
    ok: false,
    details: rows.map((row) => `${row.table_name}.${row.column_name}`),
  };
}

async function loadExistingSeedState(db: CentreOptionSeedDb) {
  const rows = await db.query<ExistingOptionSetRow>(
    `SELECT
       option_sets.id AS option_set_id,
       option_sets.code AS option_set_code,
       option_sets.label AS option_set_label,
       option_sets.allow_multi,
       option_sets.sort_order AS option_set_sort_order,
       options.id AS option_id,
       options.code AS option_code,
       options.label AS option_label,
       options.sort_order AS option_sort_order,
       options.is_active AS option_is_active
     FROM centre_option_sets option_sets
     LEFT JOIN centre_options options
       ON options.option_set_id = option_sets.id
     WHERE option_sets.code = ANY($1::text[])
     ORDER BY option_sets.sort_order ASC, options.sort_order ASC NULLS LAST`,
    [CENTRE_OPTION_SEED_SETS.map((optionSet) => optionSet.code)]
  );
  const optionSets = new Map<
    CentreOptionSetCode,
    { id: number; label: string; allowMulti: boolean; sortOrder: number }
  >();
  const options = new Map<
    string,
    ExistingSeedOption
  >();

  for (const row of rows) {
    const setCode = row.option_set_code as CentreOptionSetCode;
    if (!CENTRE_OPTION_SEED_SETS.some((optionSet) => optionSet.code === setCode)) {
      continue;
    }

    optionSets.set(setCode, {
      id: numberFromDb(row.option_set_id),
      label: String(row.option_set_label ?? ""),
      allowMulti: booleanFromDb(row.allow_multi),
      sortOrder: numberFromDb(row.option_set_sort_order),
    });

    if (row.option_code) {
      options.set(optionKey(setCode, row.option_code), {
        optionSetCode: setCode,
        code: row.option_code,
        label: String(row.option_label ?? ""),
        sortOrder: numberFromDb(row.option_sort_order),
        isActive: booleanFromDb(row.option_is_active),
      });
    }
  }

  return { optionSets, options };
}

async function applySeedOptionSets(db: CentreOptionSeedDb): Promise<void> {
  const params = CENTRE_OPTION_SEED_SETS.flatMap((optionSet) => [
    optionSet.code,
    optionSet.label,
    optionSet.allowMulti,
    optionSet.sortOrder,
  ]);
  const values = CENTRE_OPTION_SEED_SETS.map(
    (_optionSet, index) =>
      `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${
        index * 4 + 4
      })`
  ).join(", ");

  await db.query(
    `INSERT INTO centre_option_sets (code, label, allow_multi, sort_order)
     VALUES ${values}
     ON CONFLICT (code) DO UPDATE
     SET label = EXCLUDED.label,
         allow_multi = EXCLUDED.allow_multi,
         sort_order = EXCLUDED.sort_order,
         updated_at = NOW()
     WHERE centre_option_sets.label IS DISTINCT FROM EXCLUDED.label
        OR centre_option_sets.allow_multi IS DISTINCT FROM EXCLUDED.allow_multi
        OR centre_option_sets.sort_order IS DISTINCT FROM EXCLUDED.sort_order`,
    params
  );
}

async function applySeedOptions(db: CentreOptionSeedDb): Promise<void> {
  const params = CENTRE_OPTION_SEED_OPTIONS.flatMap((option) => [
    option.optionSetCode,
    option.code,
    option.label,
    option.sortOrder,
    option.isActive,
  ]);
  const values = CENTRE_OPTION_SEED_OPTIONS.map(
    (_option, index) =>
      `($${index * 5 + 1}::text, $${index * 5 + 2}::text, $${index * 5 + 3}::text, $${
        index * 5 + 4
      }::integer, $${index * 5 + 5}::boolean)`
  ).join(", ");

  await db.query(
    `WITH seed_options(option_set_code, code, label, sort_order, is_active) AS (
       VALUES ${values}
     )
     INSERT INTO centre_options (option_set_id, code, label, sort_order, is_active)
     SELECT option_sets.id,
            seed_options.code,
            seed_options.label,
            seed_options.sort_order,
            seed_options.is_active
     FROM seed_options
     JOIN centre_option_sets option_sets
       ON option_sets.code = seed_options.option_set_code
     ON CONFLICT (option_set_id, code) DO UPDATE
     SET label = EXCLUDED.label,
         sort_order = EXCLUDED.sort_order,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
     WHERE centre_options.label IS DISTINCT FROM EXCLUDED.label
        OR centre_options.sort_order IS DISTINCT FROM EXCLUDED.sort_order
        OR centre_options.is_active IS DISTINCT FROM EXCLUDED.is_active`,
    params
  );
}

function emptyReport(mode: CentreOptionSeedMode): CentreOptionSeedReport {
  return {
    ok: true,
    mode,
    counts: {
      optionSets: zeroCounts(),
      options: zeroCounts(),
    },
    changes: {
      optionSets: emptyChangeGroups(),
      options: emptyChangeGroups(),
    },
  };
}

function emptyChangeGroups() {
  return { created: [], updated: [], unchanged: [], skipped: [] };
}

function zeroCounts(): CentreOptionSeedCounts {
  return { created: 0, updated: 0, unchanged: 0, skipped: 0 };
}

function optionKey(optionSetCode: CentreOptionSetCode, optionCode: string): string {
  return `${optionSetCode}:${optionCode}`;
}

function numberFromDb(value: string | number | null): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function booleanFromDb(value: boolean | string | null): boolean {
  return value === true || value === "true";
}
