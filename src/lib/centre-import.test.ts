import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  loadCentreImportSource,
  runCentreCsvImport,
  type CentreImportDb,
} from "./centre-import";
import { CENTRE_OPTION_SEED_OPTIONS } from "./centre-option-seed";

class FakeImportDb implements CentreImportDb {
  readonly calls: Array<{ sql: string; params?: unknown[] }> = [];

  constructor(private readonly responses: unknown[][]) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.calls.push({ sql, params });
    return (this.responses.shift() ?? []) as T[];
  }
}

describe("Centre CSV import", () => {
  it("parses the checked-in Centre export with quoted multiline fields", async () => {
    const rows = await loadCentreImportSource();

    expect(rows).toHaveLength(54);
    expect(rows[0]).toMatchObject({
      sourceId: "1",
      name: "JNV Barwani",
      typeCode: "coe",
      streamCodes: ["jee"],
      isPhysical: true,
      isActive: true,
    });
    expect(rows[6].name).toBe("JNV Thiruvananthapuram");
    expect(rows[6].sourceNotes).toContain("April 1 - the 20 selected kids");
  });

  it("dry-runs the checked-in source and mapping without writing Centre rows", async () => {
    const db = new FakeImportDb([
      [],
      optionRows(),
      [{ count: "0" }],
      approvedSchoolIdRows(),
      [],
    ]);

    const result = await runCentreCsvImport({ db });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("dry-run");
    expect(result.counts).toMatchObject({
      parsedRows: 54,
      mappingRows: 54,
      mappedRows: 54,
      physicalRows: 42,
      nonPhysicalRows: 12,
      rowsThatWouldBeInserted: 54,
    });
    expect(result.issues.missingMappingSourceIds).toEqual([]);
    expect(result.issues.duplicateMappingSourceIds).toEqual([]);
    expect(result.issues.invalidOptionCodes).toEqual([]);
    expect(result.issues.unresolvedMappings).toHaveLength(42);
    expect(result.issues.ambiguousMappings).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(
      db.calls.some((call) => /\b(insert|update|delete)\b/i.test(call.sql))
    ).toBe(false);
  });

  it("applies unresolved mappings with null school_id for later cleanup", async () => {
    const db = new FakeImportDb([
      [],
      optionRows(),
      [{ count: "0" }],
      approvedSchoolIdRows(),
      [],
      [],
    ]);

    const result = await runCentreCsvImport({ mode: "apply", db });

    expect(result.ok).toBe(true);
    expect(result.issues.unresolvedMappings).toHaveLength(42);
    expect(
      db.calls.some((call) => /\bINSERT\s+INTO\s+centres\b/i.test(call.sql))
    ).toBe(true);
  });

  it("auto-matches unresolved mappings by exact school name", async () => {
    const { sourcePath, mappingPath } = await writeImportFiles(
      `id,name,cost_centre_type,count_as_physical_2627,school_name,program,coe_type_2526,category_2627,vg_notes,is_active
1,JNV Barwani,CoE,1,JNV Barwani,JEE,Regional CoE,Cat 1 CoE,,1
`,
      `source_id,centre_name,status,school_id
1,JNV Barwani,unresolved,
`
    );
    const db = new FakeImportDb([
      [],
      optionRows(),
      [{ count: "0" }],
      [{ id: 60, name: "JNV Barwani" }],
      [],
    ]);

    const result = await runCentreCsvImport({
      mode: "apply",
      db,
      sourcePath,
      mappingPath,
    });

    expect(result.ok).toBe(true);
    expect(result.counts.autoMatchedSchoolRows).toBe(1);
    expect(result.issues.unresolvedSchoolNameMatches).toEqual([]);

    const insertCall = db.calls.find((call) =>
      /\bINSERT\s+INTO\s+centres\b/i.test(call.sql)
    );
    expect(insertCall?.params?.[1]).toBe(60);
  });

  it("applies valid approved and intentionally unlinked Centre rows insert-only", async () => {
    const { sourcePath, mappingPath } = await writeImportFiles(
      `id,name,cost_centre_type,count_as_physical_2627,school_name,program,coe_type_2526,category_2627,vg_notes,is_active
1,JNV Test,CoE,1,JNV Test,JEE + NEET,Regional CoE,Cat 1 CoE,,1
2,Bench Teachers,,,,,,,,1
`,
      `source_id,centre_name,status,school_id
1,JNV Test,approved,101
2,Bench Teachers,unlinked,
`
    );
    const db = new FakeImportDb([
      [],
      optionRows(),
      [{ count: "0" }],
      [{ id: 101 }],
      [],
    ]);

    const result = await runCentreCsvImport({
      mode: "apply",
      db,
      sourcePath,
      mappingPath,
    });

    expect(result.ok).toBe(true);
    expect(result.counts.rowsThatWouldBeInserted).toBe(2);

    const insertCall = db.calls.find((call) =>
      /\bINSERT\s+INTO\s+centres\b/i.test(call.sql)
    );
    expect(insertCall?.sql).toContain(
      "name, school_id, type_code, category_code, sub_category_code, stream_codes, is_physical, is_active"
    );
    expect(insertCall?.sql).not.toContain("region");
    expect(insertCall?.sql).not.toContain("district");
    expect(insertCall?.params).toEqual([
      "JNV Test",
      101,
      "coe",
      "cat_1_coe",
      "regional_coe",
      ["jee", "neet"],
      true,
      true,
      "Bench Teachers",
      null,
      null,
      null,
      null,
      [],
      false,
      true,
    ]);
  });

  it("blocks approved mappings whose school_id is not in the school table", async () => {
    const { sourcePath, mappingPath } = await writeImportFiles(
      `id,name,cost_centre_type,count_as_physical_2627,school_name,program,coe_type_2526,category_2627,vg_notes,is_active
1,JNV Missing School,CoE,1,JNV Missing School,JEE,Regional CoE,Cat 1 CoE,,1
`,
      `source_id,centre_name,status,school_id
1,JNV Missing School,approved,999
`
    );
    const db = new FakeImportDb([[], optionRows(), [{ count: "0" }], []]);

    const result = await runCentreCsvImport({
      mode: "apply",
      db,
      sourcePath,
      mappingPath,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.invalidSchoolIds).toContainEqual({
      sourceId: "1",
      name: "JNV Missing School",
      field: "school_id",
      code: "999",
    });
    expect(
      db.calls.some((call) => /\bINSERT\s+INTO\s+centres\b/i.test(call.sql))
    ).toBe(false);
  });

  it("reports invalid option codes before apply", async () => {
    const { sourcePath, mappingPath } = await writeImportFiles(
      `id,name,cost_centre_type,count_as_physical_2627,school_name,program,coe_type_2526,category_2627,vg_notes,is_active
1,JNV Invalid,CoE,1,JNV Invalid,SAT,Regional CoE,Cat 1 CoE,,1
`,
      `source_id,centre_name,status,school_id
1,JNV Invalid,unlinked,
`
    );
    const db = new FakeImportDb([[], optionRows(), [{ count: "0" }]]);

    const result = await runCentreCsvImport({ db, sourcePath, mappingPath });

    expect(result.issues.invalidOptionCodes).toEqual([
      {
        sourceId: "1",
        name: "JNV Invalid",
        field: "stream",
        code: "sat",
      },
    ]);
    expect(result.blockers).toContain(
      "Seed or fix invalid Centre option codes before apply."
    );
    expect(result.counts.rowsThatWouldBeInserted).toBe(0);
  });

  it("reports duplicate and missing mapping rows", async () => {
    const { sourcePath, mappingPath } = await writeImportFiles(
      `id,name,cost_centre_type,count_as_physical_2627,school_name,program,coe_type_2526,category_2627,vg_notes,is_active
1,JNV One,CoE,1,JNV One,JEE,Regional CoE,Cat 1 CoE,,1
2,JNV Two,CoE,1,JNV Two,JEE,Regional CoE,Cat 1 CoE,,1
`,
      `source_id,centre_name,status,school_id
1,JNV One,unlinked,
1,JNV One Duplicate,unlinked,
`
    );
    const db = new FakeImportDb([[], optionRows(), [{ count: "0" }]]);

    const result = await runCentreCsvImport({ db, sourcePath, mappingPath });

    expect(result.issues.duplicateMappingSourceIds).toEqual(["1"]);
    expect(result.issues.missingMappingSourceIds).toEqual(["2"]);
    expect(result.blockers).toContain(
      "Add mapping rows for every parsed Centre source row."
    );
    expect(result.blockers).toContain(
      "Remove duplicate Centre mapping rows before apply."
    );
  });

  it("refuses insert-only apply when Centre rows already exist", async () => {
    const { sourcePath, mappingPath } = await writeImportFiles(
      `id,name,cost_centre_type,count_as_physical_2627,school_name,program,coe_type_2526,category_2627,vg_notes,is_active
1,JNV Existing,CoE,1,JNV Existing,JEE,Regional CoE,Cat 1 CoE,,1
`,
      `source_id,centre_name,status,school_id
1,JNV Existing,unlinked,
`
    );
    const db = new FakeImportDb([[], optionRows(), [{ count: "3" }]]);

    const result = await runCentreCsvImport({
      mode: "apply",
      db,
      sourcePath,
      mappingPath,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain(
      "The centres table already contains rows. Clear the new Centre tables and rerun the one-time import."
    );
    expect(
      db.calls.some((call) => /\bINSERT\s+INTO\s+centres\b/i.test(call.sql))
    ).toBe(false);
  });

  it("fails clearly when db-service Centre tables are missing", async () => {
    const db = new FakeImportDb([
      [{ table_name: "centres", column_name: "stream_codes" }],
    ]);

    const result = await runCentreCsvImport({ mode: "apply", db });

    expect(result).toMatchObject({
      ok: false,
      mode: "apply",
      error:
        "Centre import tables are unavailable. Run the db-service Centre management schema migration before importing Centres.",
      details: ["centres.stream_codes"],
    });
    expect(db.calls).toHaveLength(1);
  });
});

function optionRows() {
  return CENTRE_OPTION_SEED_OPTIONS.map((option, index) => ({
    option_id: index + 1,
    option_set_code: option.optionSetCode,
    option_code: option.code,
    option_is_active: option.isActive,
  }));
}

function approvedSchoolIdRows() {
  return [{ id: 51 }, { id: 294 }, { id: 173 }, { id: 405 }, { id: 9590 }];
}

async function writeImportFiles(sourceCsv: string, mappingCsv: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "centre-import-"));
  const sourcePath = path.join(dir, "centres.csv");
  const mappingPath = path.join(dir, "centre-school-mapping.csv");
  await writeFile(sourcePath, sourceCsv);
  await writeFile(mappingPath, mappingCsv);
  return { sourcePath, mappingPath };
}
