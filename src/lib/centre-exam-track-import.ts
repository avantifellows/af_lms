import { readFile } from "fs/promises";
import path from "path";

import { parse } from "csv-parse/sync";

import { query } from "./db";
import { isExamTrack, type ExamTrack } from "./exam-tracks";

export type CentreExamTrackImportMode = "dry-run" | "apply";

export interface CentreExamTrackImportDb {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

interface RawSourceRow {
  source_id?: string;
  centre_name?: string;
  cost_centre_type?: string;
  grade?: string;
  exam_track_code?: string;
}

interface SourceRow {
  sourceId: string;
  centreName: string;
  typeCode: string;
  grade: 11 | 12;
  examTrackCode: ExamTrack;
}

interface ParsedSourceRow {
  sourceId: string;
  centreName: string;
  typeCode: string;
  grade: string;
  examTrackCode: string;
}

interface MatchRow {
  centre_id: string | number;
  centre_name: string;
  type_code: string;
  grade_id: string | number;
  grade: string | number;
}

interface ExistingRow {
  centre_id: string | number;
  grade_id: string | number;
  exam_track_code: string;
}

export interface CentreExamTrackImportIssue {
  sourceId: string;
  centreName: string;
  typeCode: string;
  grade: string;
  examTrackCode: string;
  reason: string;
}

export interface CentreExamTrackImportReport {
  ok: boolean;
  mode: CentreExamTrackImportMode;
  counts: {
    sourceRows: number;
    validRows: number;
    intendedInserts: number;
    insertedRows: number;
    alreadyPresentRows: number;
    blockers: number;
  };
  issues: {
    unmatched: CentreExamTrackImportIssue[];
    ambiguous: CentreExamTrackImportIssue[];
    duplicate: CentreExamTrackImportIssue[];
    invalid: CentreExamTrackImportIssue[];
  };
  blockers: string[];
}

const DEFAULT_SOURCE_PATH = path.join(
  process.cwd(),
  "centres-for-crud-ui",
  "centre-exam-track-mapping.csv"
);

const defaultDb: CentreExamTrackImportDb = { query };

export async function runCentreExamTrackImport(params: {
  mode?: CentreExamTrackImportMode;
  db?: CentreExamTrackImportDb;
  sourcePath?: string;
}): Promise<CentreExamTrackImportReport> {
  const mode = params.mode ?? "dry-run";
  const db = params.db ?? defaultDb;
  const sourceRows = await loadSource(params.sourcePath ?? DEFAULT_SOURCE_PATH);
  const invalid: CentreExamTrackImportIssue[] = [];
  const rows: SourceRow[] = [];

  for (const row of sourceRows) {
    const reasons = validateSourceRow(row);
    if (reasons.length > 0) {
      invalid.push(issueFrom(row, reasons.join("; ")));
      continue;
    }
    rows.push({
      ...row,
      grade: Number(row.grade) as 11 | 12,
      examTrackCode: row.examTrackCode as ExamTrack,
    });
  }

  const duplicateKeys = new Set(
    rows
      .map(sourceKey)
      .filter((key, index, keys) => keys.indexOf(key) !== index)
  );
  const duplicate = [...duplicateKeys].map((key) =>
    issueFrom(
      rows.find((row) => sourceKey(row) === key) as SourceRow,
      "Duplicate source Centre, Grade, and Exam Track row"
    )
  );
  const candidates = rows.filter((row) => !duplicateKeys.has(sourceKey(row)));
  const matches = await db.query<MatchRow>(
    `SELECT centres.id AS centre_id,
            centres.name AS centre_name,
            centres.type_code,
            grades.id AS grade_id,
            grades.number AS grade
     FROM centres
     CROSS JOIN grade grades
     WHERE centres.name = ANY($1::text[])
       AND centres.type_code = ANY($2::text[])
       AND grades.number = ANY($3::int[])
     ORDER BY centres.id, grades.number`,
    [
      [...new Set(candidates.map((row) => row.centreName))],
      [...new Set(candidates.map((row) => row.typeCode))],
      [...new Set(candidates.map((row) => row.grade))],
    ]
  );
  const matched = candidates.map((row) => ({
    row,
    matches: matches.filter(
      (match) =>
        match.centre_name === row.centreName &&
        match.type_code === row.typeCode &&
        Number(match.grade) === row.grade
    ),
  }));
  const unmatched = matched
    .filter((entry) => entry.matches.length === 0)
    .map(({ row }) => issueFrom(row, "No Centre matched the stable source identity and Grade"));
  const ambiguous = matched
    .filter((entry) => entry.matches.length > 1)
    .map(({ row }) => issueFrom(row, "Multiple Centres matched the stable source identity and Grade"));
  const resolved = matched
    .filter((entry) => entry.matches.length === 1)
    .map(({ row, matches: [match] }) => ({ row, match }));
  const blockers = blockerMessages({ unmatched, ambiguous, duplicate, invalid });

  const existing = await db.query<ExistingRow>(
    `SELECT centre_id, grade_id, exam_track_code
     FROM centre_exam_tracks
     WHERE centre_id = ANY($1::bigint[])`,
    [[...new Set(resolved.map(({ match }) => Number(match.centre_id)))]]
  );
  const plannedInserts = resolved.filter(({ row, match }) =>
    !existing.some(
      (entry) =>
        Number(entry.centre_id) === Number(match.centre_id) &&
        Number(entry.grade_id) === Number(match.grade_id) &&
        entry.exam_track_code === row.examTrackCode
    )
  );
  const alreadyPresentRows = resolved.length - plannedInserts.length;

  if (blockers.length > 0) {
    return {
      ok: false,
      mode,
      counts: {
        sourceRows: sourceRows.length,
        validRows: rows.length,
        intendedInserts: plannedInserts.length,
        insertedRows: 0,
        alreadyPresentRows,
        blockers: blockers.length,
      },
      issues: { unmatched, ambiguous, duplicate, invalid },
      blockers,
    };
  }

  if (mode === "apply" && plannedInserts.length > 0) {
    const values = plannedInserts
      .map((_, index) => {
        const offset = index * 3;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
      })
      .join(", ");
    await db.query(
      `INSERT INTO centre_exam_tracks (centre_id, grade_id, exam_track_code)
       VALUES ${values}
       ON CONFLICT (centre_id, grade_id, exam_track_code) DO NOTHING`,
      plannedInserts.flatMap(({ row, match }) => [
        Number(match.centre_id),
        Number(match.grade_id),
        row.examTrackCode,
      ])
    );
  }

  return {
    ok: true,
    mode,
    counts: {
      sourceRows: sourceRows.length,
      validRows: rows.length,
      intendedInserts: plannedInserts.length,
      insertedRows: mode === "apply" ? plannedInserts.length : 0,
      alreadyPresentRows,
      blockers: 0,
    },
    issues: { unmatched, ambiguous, duplicate, invalid },
    blockers: [],
  };
}

async function loadSource(sourcePath: string): Promise<ParsedSourceRow[]> {
  const content = await readFile(sourcePath, "utf8");
  const rows = parse(content, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawSourceRow[];

  return rows.map((row) => ({
    sourceId: String(row.source_id ?? "").trim(),
    centreName: String(row.centre_name ?? "").trim(),
    typeCode: String(row.cost_centre_type ?? "").trim().toLowerCase(),
    grade: String(row.grade ?? "").trim(),
    examTrackCode: String(row.exam_track_code ?? "").trim(),
  }));
}

function validateSourceRow(row: ParsedSourceRow): string[] {
  const reasons: string[] = [];
  if (!row.sourceId || !row.centreName || !row.typeCode) {
    reasons.push("Source Centre identity is required");
  }
  if (row.grade !== "11" && row.grade !== "12") {
    reasons.push("Grade must be 11 or 12");
  }
  if (!isExamTrack(row.examTrackCode)) {
    reasons.push("unsupported Exam Track code");
  }
  return reasons;
}

function sourceKey(row: SourceRow): string {
  return `${row.sourceId}\u0000${row.grade}\u0000${row.examTrackCode}`;
}

function issueFrom(
  row: ParsedSourceRow | SourceRow,
  reason: string
): CentreExamTrackImportIssue {
  return {
    sourceId: row.sourceId,
    centreName: row.centreName,
    typeCode: row.typeCode,
    grade: String(row.grade),
    examTrackCode: row.examTrackCode,
    reason,
  };
}

function blockerMessages(issues: CentreExamTrackImportReport["issues"]): string[] {
  const blockers: string[] = [];
  if (issues.unmatched.length > 0) blockers.push("Resolve unmatched Centre rows.");
  if (issues.ambiguous.length > 0) blockers.push("Resolve ambiguous Centre rows.");
  if (issues.duplicate.length > 0) blockers.push("Remove duplicate source rows.");
  if (issues.invalid.length > 0) blockers.push("Fix invalid source rows.");
  return blockers;
}
