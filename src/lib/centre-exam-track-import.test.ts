import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCentreExamTrackImportArgs } from "./centre-exam-track-import-cli";
import {
  runCentreExamTrackImport,
  type CentreExamTrackImportDb,
} from "./centre-exam-track-import";

class FakeImportDb implements CentreExamTrackImportDb {
  readonly calls: Array<{ sql: string; params?: unknown[] }> = [];

  constructor(private readonly responses: unknown[][]) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.calls.push({ sql, params });
    return (this.responses.shift() ?? []) as T[];
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("Centre Exam Track import", () => {
  it("parses dry-run/apply and environment arguments without an implicit write mode", () => {
    expect(parseCentreExamTrackImportArgs([])).toEqual({
      mode: "dry-run",
      envFile: ".env.local",
      help: false,
    });
    expect(parseCentreExamTrackImportArgs(["--apply", "--env=production"])).toEqual({
      mode: "apply",
      envFile: ".env.production",
      help: false,
    });
    expect(parseCentreExamTrackImportArgs(["--file", "/tmp/tracks.csv"])).toEqual({
      mode: "dry-run",
      envFile: ".env.local",
      help: false,
      sourcePath: "/tmp/tracks.csv",
    });
    expect(parseCentreExamTrackImportArgs(["--file=/tmp/tracks.csv"]).sourcePath)
      .toBe("/tmp/tracks.csv");
    expect(() => parseCentreExamTrackImportArgs(["--file"]))
      .toThrow("--file requires a path.");
    expect(() => parseCentreExamTrackImportArgs(["--apply", "--dry-run"]))
      .toThrow("Use either --apply or --dry-run, not both.");
  });

  it("defaults to a dry-run and reports intended inserts without writing", async () => {
    const sourcePath = await writeSource(`source_id,centre_name,cost_centre_type,grade,exam_track_code
centre-1,JNV Test,CoE,11,jee_main
`);
    const db = new FakeImportDb([
      [
        { centre_id: "40", centre_name: "JNV Test", type_code: "nodal", grade_id: "7", grade: "11" },
        { centre_id: "41", centre_name: "JNV Test", type_code: "coe", grade_id: "7", grade: "11" },
      ],
      [],
    ]);

    const report = await runCentreExamTrackImport({ db, sourcePath });

    expect(report).toMatchObject({
      ok: true,
      mode: "dry-run",
      counts: {
        sourceRows: 1,
        validRows: 1,
        intendedInserts: 1,
        insertedRows: 0,
        alreadyPresentRows: 0,
        blockers: 0,
      },
      blockers: [],
      issues: { unmatched: [], ambiguous: [], duplicate: [], invalid: [] },
    });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].sql).toContain("centres.type_code");
    expect(db.calls.some((call) => /\bINSERT\b/i.test(call.sql))).toBe(false);
  });

  it("apply performs exactly the inserts in the report", async () => {
    const sourcePath = await writeSource(`source_id,centre_name,cost_centre_type,grade,exam_track_code
centre-1,JNV Test,CoE,11,jee_main
centre-1,JNV Test,CoE,12,jee_advanced
`);
    const db = new FakeImportDb([
      [
        { centre_id: "41", centre_name: "JNV Test", type_code: "coe", grade_id: "7", grade: "11" },
        { centre_id: "41", centre_name: "JNV Test", type_code: "coe", grade_id: "8", grade: "12" },
      ],
      [{ centre_id: "41", grade_id: "7", exam_track_code: "jee_main" }],
      [{ centre_id: "41", grade_id: "8", exam_track_code: "jee_advanced" }],
    ]);

    const report = await runCentreExamTrackImport({ mode: "apply", db, sourcePath });

    expect(report.counts).toMatchObject({
      intendedInserts: 1,
      insertedRows: 1,
      alreadyPresentRows: 1,
    });
    const insert = db.calls.find((call) => /INSERT INTO centre_exam_tracks/i.test(call.sql));
    expect(insert?.params).toEqual([41, 8, "jee_advanced"]);
    expect(insert?.sql).toContain("RETURNING centre_id, grade_id, exam_track_code");
  });

  it("blocks source rows that resolve to the same target mapping", async () => {
    const sourcePath = await writeSource(`source_id,centre_name,cost_centre_type,grade,exam_track_code
centre-a,JNV Test,CoE,11,jee_main
centre-b,JNV Test,CoE,11,jee_main
`);
    const db = new FakeImportDb([
      [
        { centre_id: "41", centre_name: "JNV Test", type_code: "coe", grade_id: "7", grade: "11" },
      ],
      [],
    ]);

    const report = await runCentreExamTrackImport({ mode: "apply", db, sourcePath });

    expect(report.ok).toBe(false);
    expect(report.issues.duplicate).toEqual([
      expect.objectContaining({
        sourceId: "centre-a",
        reason: "Multiple source rows resolve to the same Centre, Grade, and Exam Track",
      }),
    ]);
    expect(report.counts).toMatchObject({ intendedInserts: 0, insertedRows: 0, blockers: 1 });
    expect(db.calls.some((call) => /\bINSERT\b/i.test(call.sql))).toBe(false);
  });

  it("puts every blocker kind in its typed bucket and refuses apply", async () => {
    const sourcePath = await writeSource(`source_id,centre_name,cost_centre_type,grade,exam_track_code
missing,JNV Missing,CoE,11,jee_main
ambiguous,JNV Same,Nodal,12,neet
duplicate,JNV One,CoE,11,cet
duplicate,JNV One,CoE,11,cet
invalid,JNV Bad,CoE,10,sat
valid,JNV Valid,CoE,12,math_foundation
`);
    const db = new FakeImportDb([
      [
        { centre_id: "51", centre_name: "JNV Same", type_code: "nodal", grade_id: "8", grade: "12" },
        { centre_id: "52", centre_name: "JNV Same", type_code: "nodal", grade_id: "8", grade: "12" },
        { centre_id: "61", centre_name: "JNV One", type_code: "coe", grade_id: "7", grade: "11" },
        { centre_id: "71", centre_name: "JNV Valid", type_code: "coe", grade_id: "8", grade: "12" },
      ],
      [],
    ]);

    const report = await runCentreExamTrackImport({ mode: "apply", db, sourcePath });

    expect(report.ok).toBe(false);
    expect(report.issues.unmatched.map((issue) => issue.sourceId)).toEqual(["missing"]);
    expect(report.issues.ambiguous.map((issue) => issue.sourceId)).toEqual(["ambiguous"]);
    expect(report.issues.duplicate.map((issue) => issue.sourceId)).toEqual(["duplicate"]);
    expect(report.issues.invalid).toEqual([
      expect.objectContaining({ sourceId: "invalid", reason: "Grade must be 11 or 12; unsupported Exam Track code" }),
    ]);
    expect(report.blockers).toHaveLength(4);
    expect(report.counts).toMatchObject({
      sourceRows: 6,
      validRows: 5,
      intendedInserts: 1,
      insertedRows: 0,
      blockers: 4,
    });
    expect(db.calls).toHaveLength(2);
    expect(db.calls.some((call) => /\bINSERT\b/i.test(call.sql))).toBe(false);
  });
});

async function writeSource(csv: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ralph-252-centre-exam-track-import-"));
  tempDirs.push(dir);
  const sourcePath = path.join(dir, "centre-exam-track-mapping.csv");
  await writeFile(sourcePath, csv);
  return sourcePath;
}
