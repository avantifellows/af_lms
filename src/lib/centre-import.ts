import { readFile } from "fs/promises";
import path from "path";

import { parse } from "csv-parse/sync";

import { query } from "./db";
import type { CentreOptionSetCode } from "./centres";

export type CentreImportMode = "dry-run" | "apply";

export interface CentreImportDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CentreImportSourceRow {
  sourceId: string;
  name: string;
  schoolName: string | null;
  typeCode: string | null;
  categoryCode: string | null;
  subCategoryCode: string | null;
  streamCodes: string[];
  isPhysical: boolean;
  isActive: boolean;
  sourceNotes: string;
}

export interface CentreImportIssueRef {
  sourceId: string;
  name?: string;
  status?: string;
  field?: string;
  code?: string;
}

export interface CentreCsvImportReport {
  ok: boolean;
  mode: CentreImportMode;
  error?: string;
  details?: string[];
  counts: {
    parsedRows: number;
    mappingRows: number;
    mappedRows: number;
    physicalRows: number;
    nonPhysicalRows: number;
    rowsThatWouldBeInserted: number;
    existingCentreRows: number;
  };
  blockers: string[];
  issues: {
    missingMappingSourceIds: string[];
    duplicateMappingSourceIds: string[];
    invalidMappingRows: CentreImportIssueRef[];
    unresolvedMappings: CentreImportIssueRef[];
    ambiguousMappings: CentreImportIssueRef[];
    invalidOptionCodes: CentreImportIssueRef[];
    invalidSchoolIds: CentreImportIssueRef[];
  };
}

interface RawCentreCsvRow {
  id?: string;
  name?: string;
  school_name?: string;
  cost_centre_type?: string;
  count_as_physical_2627?: string;
  program?: string;
  coe_type_2526?: string;
  category_2627?: string;
  vg_notes?: string;
  is_active?: string;
}

interface RawCentreMappingRow {
  source_id?: string;
  centre_name?: string;
  status?: string;
  school_id?: string;
}

interface OptionCodeRow {
  option_set_code: string;
  option_code: string;
  option_is_active: boolean | string | null;
}

interface MissingColumnRow {
  table_name: string;
  column_name: string;
}

interface CountRow {
  count: string | number;
}

interface SchoolIdRow {
  id: string | number;
}

type CentreMappingStatus = "approved" | "unlinked" | "ambiguous" | "unresolved";

interface CentreMappingRow {
  sourceId: string;
  centreName: string;
  status: CentreMappingStatus | string;
  schoolId: number | null;
}

const DEFAULT_SOURCE_PATH = path.join(
  process.cwd(),
  "centres-for-crud-ui",
  "centres.csv"
);

const DEFAULT_MAPPING_PATH = path.join(
  process.cwd(),
  "centres-for-crud-ui",
  "centre-school-mapping.csv"
);

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "centres", column: "id" },
  { table: "centres", column: "name" },
  { table: "centres", column: "school_id" },
  { table: "centres", column: "type_code" },
  { table: "centres", column: "category_code" },
  { table: "centres", column: "sub_category_code" },
  { table: "centres", column: "stream_codes" },
  { table: "centres", column: "is_physical" },
  { table: "centres", column: "is_active" },
  { table: "centres", column: "inserted_at" },
  { table: "centres", column: "updated_at" },
  { table: "centre_option_sets", column: "id" },
  { table: "centre_option_sets", column: "code" },
  { table: "centre_options", column: "option_set_id" },
  { table: "centre_options", column: "code" },
  { table: "centre_options", column: "is_active" },
];

const TYPE_CODES = new Map([
  ["CoE", "coe"],
  ["Nodal", "nodal"],
]);

const CATEGORY_CODES = new Map([
  ["Cat 1 CoE", "cat_1_coe"],
  ["Cat 2 CoE", "cat_2_coe"],
  ["Foundation", "foundation"],
  ["Nodal", "nodal"],
]);

const SUB_CATEGORY_CODES = new Map([
  ["Cat 2 CoE", "cat_2_coe"],
  ["Coaching center", "coaching_center"],
  ["Regional CoE", "regional_coe"],
  ["State CoE", "state_coe"],
  ["Nodal", "nodal"],
]);

const defaultDb: CentreImportDb = { query };

export async function runCentreCsvImport(params: {
  mode?: CentreImportMode;
  db?: CentreImportDb;
  sourcePath?: string;
  mappingPath?: string;
}): Promise<CentreCsvImportReport> {
  const mode = params.mode ?? "dry-run";
  const db = params.db ?? defaultDb;
  const report = emptyReport(mode);
  const schema = await checkImportSchema(db);

  if (!schema.ok) {
    return {
      ...report,
      ok: false,
      error:
        "Centre import tables are unavailable. Run the db-service Centre management schema migration before importing Centres.",
      details: schema.details,
    };
  }

  const sourceRows = await loadCentreImportSource(params.sourcePath);
  const mappings = await loadCentreSchoolMapping(params.mappingPath);
  const activeOptionCodes = await loadActiveOptionCodes(db);
  const existingCentreRows = await countExistingCentres(db);

  report.counts.parsedRows = sourceRows.length;
  report.counts.mappingRows = mappings.length;
  report.counts.physicalRows = sourceRows.filter((row) => row.isPhysical).length;
  report.counts.nonPhysicalRows =
    sourceRows.length - report.counts.physicalRows;
  report.counts.existingCentreRows = existingCentreRows;

  const mappingValidation = validateMappings(sourceRows, mappings);
  report.counts.mappedRows = mappingValidation.mappedRows;
  report.issues.missingMappingSourceIds =
    mappingValidation.missingMappingSourceIds;
  report.issues.duplicateMappingSourceIds =
    mappingValidation.duplicateMappingSourceIds;
  report.issues.invalidMappingRows = mappingValidation.invalidMappingRows;
  report.issues.unresolvedMappings = mappingValidation.unresolvedMappings;
  report.issues.ambiguousMappings = mappingValidation.ambiguousMappings;
  report.issues.invalidSchoolIds = mappingValidation.invalidSchoolIds;
  const approvedSchoolMappings = collectApprovedSchoolMappings(mappings);
  const approvedSchoolIds = approvedSchoolMappings.map(
    (mapping) => mapping.schoolId as number
  );
  if (approvedSchoolIds.length > 0) {
    const existingSchoolIds = await loadExistingSchoolIds(db, approvedSchoolIds);
    for (const mapping of approvedSchoolMappings) {
      const schoolId = mapping.schoolId as number;
      if (!existingSchoolIds.has(schoolId)) {
        report.issues.invalidSchoolIds.push({
          sourceId: mapping.sourceId,
          name: mapping.centreName,
          field: "school_id",
          code: String(schoolId),
        });
      }
    }
  }
  report.issues.invalidOptionCodes = validateOptionCodes(
    sourceRows,
    activeOptionCodes
  );

  addBlockers(report);
  report.counts.rowsThatWouldBeInserted =
    report.blockers.length === 0 ? sourceRows.length : 0;

  if (mode === "apply" && report.blockers.length > 0) {
    return {
      ...report,
      ok: false,
      error: "Centre CSV import is not ready to apply.",
    };
  }

  if (mode === "apply") {
    await insertCentreRows(db, sourceRows, mappings);
  }

  return report;
}

export async function loadCentreImportSource(
  sourcePath = DEFAULT_SOURCE_PATH
): Promise<CentreImportSourceRow[]> {
  const content = await readFile(sourcePath, "utf8");
  const rows = parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: false,
  }) as RawCentreCsvRow[];

  return rows.map(mapSourceRow);
}

export async function loadCentreSchoolMapping(
  mappingPath = DEFAULT_MAPPING_PATH
): Promise<CentreMappingRow[]> {
  const content = await readFile(mappingPath, "utf8");
  const rows = parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawCentreMappingRow[];

  return rows.map((row) => ({
    sourceId: requiredText(row.source_id, "source_id"),
    centreName: requiredText(row.centre_name, "centre_name"),
    status: requiredText(row.status, "status"),
    schoolId: nullableInteger(row.school_id),
  }));
}

async function checkImportSchema(
  db: CentreImportDb
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

async function loadActiveOptionCodes(db: CentreImportDb) {
  const rows = await db.query<OptionCodeRow>(
    `SELECT option_sets.code AS option_set_code,
            options.code AS option_code,
            options.is_active AS option_is_active
     FROM centre_option_sets option_sets
     JOIN centre_options options
       ON options.option_set_id = option_sets.id
     WHERE option_sets.code = ANY($1::text[])
       AND options.is_active = true`,
    [["type", "category", "sub_category", "stream"]]
  );
  const codes = new Map<CentreOptionSetCode, Set<string>>();

  for (const setCode of [
    "type",
    "category",
    "sub_category",
    "stream",
  ] as CentreOptionSetCode[]) {
    codes.set(setCode, new Set());
  }

  for (const row of rows) {
    if (!isCentreOptionSetCode(row.option_set_code)) continue;
    if (!booleanFromDb(row.option_is_active)) continue;
    codes.get(row.option_set_code)?.add(row.option_code);
  }

  return codes;
}

async function countExistingCentres(db: CentreImportDb): Promise<number> {
  const rows = await db.query<CountRow>("SELECT COUNT(*) AS count FROM centres");
  return numberFromDb(rows[0]?.count ?? 0);
}

async function loadExistingSchoolIds(
  db: CentreImportDb,
  schoolIds: number[]
): Promise<Set<number>> {
  const rows = await db.query<SchoolIdRow>(
    "SELECT id FROM school WHERE id = ANY($1::int[])",
    [[...new Set(schoolIds)]]
  );
  return new Set(rows.map((row) => numberFromDb(row.id)));
}

async function insertCentreRows(
  db: CentreImportDb,
  sourceRows: CentreImportSourceRow[],
  mappings: CentreMappingRow[]
): Promise<void> {
  if (sourceRows.length === 0) return;

  const mappingsBySourceId = new Map(
    mappings.map((mapping) => [mapping.sourceId, mapping])
  );
  const params = sourceRows.flatMap((row) => {
    const mapping = mappingsBySourceId.get(row.sourceId);
    return [
      row.name,
      mapping?.status === "approved" ? mapping.schoolId : null,
      row.typeCode,
      row.categoryCode,
      row.subCategoryCode,
      row.streamCodes,
      row.isPhysical,
      row.isActive,
    ];
  });
  const values = sourceRows
    .map((_, index) => {
      const offset = index * 8;
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${
        offset + 4
      }, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`;
    })
    .join(", ");

  await db.query(
    `INSERT INTO centres
       (name, school_id, type_code, category_code, sub_category_code, stream_codes, is_physical, is_active)
     VALUES ${values}`,
    params
  );
}

function validateMappings(
  sourceRows: CentreImportSourceRow[],
  mappings: CentreMappingRow[]
) {
  const sourceIds = new Set(sourceRows.map((row) => row.sourceId));
  const mappingsBySourceId = new Map<string, CentreMappingRow[]>();
  const invalidMappingRows: CentreImportIssueRef[] = [];
  const unresolvedMappings: CentreImportIssueRef[] = [];
  const ambiguousMappings: CentreImportIssueRef[] = [];
  const invalidSchoolIds: CentreImportIssueRef[] = [];

  for (const mapping of mappings) {
    const existing = mappingsBySourceId.get(mapping.sourceId) ?? [];
    existing.push(mapping);
    mappingsBySourceId.set(mapping.sourceId, existing);

    if (!sourceIds.has(mapping.sourceId)) {
      invalidMappingRows.push({
        sourceId: mapping.sourceId,
        name: mapping.centreName,
        status: mapping.status,
      });
    }

    if (!isMappingStatus(mapping.status)) {
      invalidMappingRows.push({
        sourceId: mapping.sourceId,
        name: mapping.centreName,
        status: mapping.status,
      });
      continue;
    }

    if (mapping.status === "unresolved") {
      unresolvedMappings.push(mappingRef(mapping));
    } else if (mapping.status === "ambiguous") {
      ambiguousMappings.push(mappingRef(mapping));
    } else if (mapping.status === "approved" && mapping.schoolId === null) {
      invalidSchoolIds.push(mappingRef(mapping));
    } else if (mapping.status === "unlinked" && mapping.schoolId !== null) {
      invalidSchoolIds.push(mappingRef(mapping));
    }
  }

  const missingMappingSourceIds = sourceRows
    .filter((row) => !mappingsBySourceId.has(row.sourceId))
    .map((row) => row.sourceId);
  const duplicateMappingSourceIds = [...mappingsBySourceId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([sourceId]) => sourceId);

  return {
    mappedRows: sourceRows.length - missingMappingSourceIds.length,
    missingMappingSourceIds,
    duplicateMappingSourceIds,
    invalidMappingRows,
    unresolvedMappings,
    ambiguousMappings,
    invalidSchoolIds,
  };
}

function validateOptionCodes(
  sourceRows: CentreImportSourceRow[],
  activeOptionCodes: Map<CentreOptionSetCode, Set<string>>
): CentreImportIssueRef[] {
  const issues: CentreImportIssueRef[] = [];

  for (const row of sourceRows) {
    validateSingleOption(row, "type", row.typeCode, activeOptionCodes, issues);
    validateSingleOption(
      row,
      "category",
      row.categoryCode,
      activeOptionCodes,
      issues
    );
    validateSingleOption(
      row,
      "sub_category",
      row.subCategoryCode,
      activeOptionCodes,
      issues
    );

    for (const streamCode of row.streamCodes) {
      if (!activeOptionCodes.get("stream")?.has(streamCode)) {
        issues.push({
          sourceId: row.sourceId,
          name: row.name,
          field: "stream",
          code: streamCode,
        });
      }
    }
  }

  return issues;
}

function validateSingleOption(
  row: CentreImportSourceRow,
  field: CentreOptionSetCode,
  code: string | null,
  activeOptionCodes: Map<CentreOptionSetCode, Set<string>>,
  issues: CentreImportIssueRef[]
): void {
  if (!code) return;
  if (activeOptionCodes.get(field)?.has(code)) return;
  issues.push({ sourceId: row.sourceId, name: row.name, field, code });
}

function addBlockers(report: CentreCsvImportReport): void {
  if (report.issues.missingMappingSourceIds.length > 0) {
    report.blockers.push("Add mapping rows for every parsed Centre source row.");
  }
  if (report.issues.duplicateMappingSourceIds.length > 0) {
    report.blockers.push("Remove duplicate Centre mapping rows before apply.");
  }
  if (report.issues.invalidMappingRows.length > 0) {
    report.blockers.push("Fix invalid Centre mapping rows before apply.");
  }
  if (
    report.issues.unresolvedMappings.length > 0 ||
    report.issues.ambiguousMappings.length > 0
  ) {
    report.blockers.push(
      "Resolve or intentionally unlink all ambiguous/unresolved mappings before apply."
    );
  }
  if (report.issues.invalidSchoolIds.length > 0) {
    report.blockers.push(
      "Approved mappings require school_id; unlinked mappings must leave school_id blank."
    );
  }
  if (report.issues.invalidOptionCodes.length > 0) {
    report.blockers.push("Seed or fix invalid Centre option codes before apply.");
  }
  if (report.counts.existingCentreRows > 0) {
    report.blockers.push(
      "The centres table already contains rows. Clear the new Centre tables and rerun the one-time import."
    );
  }
}

function collectApprovedSchoolMappings(
  mappings: CentreMappingRow[]
): CentreMappingRow[] {
  return mappings
    .filter((mapping) => mapping.status === "approved" && mapping.schoolId !== null)
    .filter(
      (mapping, index, approvedMappings) =>
        approvedMappings.findIndex((other) => other.schoolId === mapping.schoolId) ===
        index
    );
}

function emptyReport(mode: CentreImportMode): CentreCsvImportReport {
  return {
    ok: true,
    mode,
    counts: {
      parsedRows: 0,
      mappingRows: 0,
      mappedRows: 0,
      physicalRows: 0,
      nonPhysicalRows: 0,
      rowsThatWouldBeInserted: 0,
      existingCentreRows: 0,
    },
    blockers: [],
    issues: {
      missingMappingSourceIds: [],
      duplicateMappingSourceIds: [],
      invalidMappingRows: [],
      unresolvedMappings: [],
      ambiguousMappings: [],
      invalidOptionCodes: [],
      invalidSchoolIds: [],
    },
  };
}

function mapSourceRow(row: RawCentreCsvRow): CentreImportSourceRow {
  return {
    sourceId: requiredText(row.id, "id"),
    name: requiredText(row.name, "name"),
    schoolName: nullableText(row.school_name),
    typeCode: codeFromLabel(row.cost_centre_type, TYPE_CODES),
    categoryCode: codeFromLabel(row.category_2627, CATEGORY_CODES),
    subCategoryCode: codeFromLabel(row.coe_type_2526, SUB_CATEGORY_CODES),
    streamCodes: streamCodesFromProgram(row.program),
    isPhysical: booleanFromSource(row.count_as_physical_2627),
    isActive: booleanFromSource(row.is_active),
    sourceNotes: String(row.vg_notes ?? ""),
  };
}

function streamCodesFromProgram(value: string | undefined): string[] {
  const normalized = String(value ?? "").trim();
  if (!normalized) return [];
  if (normalized === "JEE") return ["jee"];
  if (normalized === "NEET") return ["neet"];
  if (normalized === "JEE + NEET") return ["jee", "neet"];
  if (normalized === "Math") return ["math_foundation"];
  return [normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")];
}

function codeFromLabel(
  value: string | undefined,
  codesByLabel: Map<string, string>
): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return codesByLabel.get(normalized) ?? normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function nullableText(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function nullableInteger(value: string | undefined): number | null {
  const normalized = nullableText(value);
  if (!normalized) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredText(value: string | undefined, field: string): string {
  const normalized = nullableText(value);
  if (!normalized) {
    throw new Error(`Centre import source row is missing ${field}.`);
  }
  return normalized;
}

function booleanFromSource(value: string | undefined): boolean {
  return String(value ?? "").trim() === "1";
}

function booleanFromDb(value: boolean | string | null): boolean {
  return value === true || value === "true";
}

function numberFromDb(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isCentreOptionSetCode(value: string): value is CentreOptionSetCode {
  return ["type", "category", "sub_category", "stream"].includes(value);
}

function isMappingStatus(value: string): value is CentreMappingStatus {
  return ["approved", "unlinked", "ambiguous", "unresolved"].includes(value);
}

function mappingRef(mapping: CentreMappingRow): CentreImportIssueRef {
  return {
    sourceId: mapping.sourceId,
    name: mapping.centreName,
    status: mapping.status,
  };
}
