import { parse } from "csv-parse/sync";

import {
  HISTORICAL_SOURCE_TIMEZONE,
  hasValidHistoricalSourceProvenance,
} from "./holistic-historical-provenance";
import type { HistoricalHolisticNoteSource } from "./holistic-operations";

const SOURCE_HEADERS = [
  "student_id",
  "question_position_index",
  "question_type",
  "question_text",
  "user_response",
  "matrix_option",
  "matrix_response",
  "start_quiz_time",
  "end_quiz_time",
] as const;

type SourceRow = Record<(typeof SOURCE_HEADERS)[number], string> & { position: number };

export interface HistoricalSourcePreparationResult {
  records: HistoricalHolisticNoteSource[];
  counts: {
    sourceRows: number;
    sourceStudents: number;
    selectedStudents: number;
    substantive: number;
    empty: number;
  };
}

export function assertApprovedHistoricalSourceCounts(
  counts: HistoricalSourcePreparationResult["counts"]
): void {
  if (counts.sourceRows !== 3_301 || counts.sourceStudents !== 159 ||
      counts.selectedStudents !== 53) {
    throw new Error("Historical source counts differ from the approved private snapshot");
  }
}

export function transformHistoricalHolisticSourceCsv(
  csvText: string,
  reviewedStudentIds: string[]
): HistoricalSourcePreparationResult {
  const rows = parseSourceRows(csvText);
  const reviewed = validateReviewedIds(reviewedStudentIds);
  const grouped = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const studentId = row.student_id;
    if (!studentId || studentId !== studentId.trim()) {
      throw new Error("Historical CSV rows are invalid");
    }
    const group = grouped.get(studentId) ?? [];
    group.push(row);
    grouped.set(studentId, group);
  }
  if ([...reviewed].some((studentId) => !grouped.has(studentId))) {
    throw new Error("Reviewed Student list does not match the private source");
  }

  const transformed = [...grouped].map(([studentId, group]) =>
    transformStudentGroup(studentId, group)
  );
  const records = transformed.filter(({ businessStudentId }) => reviewed.has(businessStudentId));
  const substantive = records.filter((record) =>
    record.questions.some(({ answer }) => Boolean(answer?.trim()))
  ).length;
  return {
    records,
    counts: {
      sourceRows: rows.length,
      sourceStudents: grouped.size,
      selectedStudents: records.length,
      substantive,
      empty: records.length - substantive,
    },
  };
}

function parseSourceRows(csvText: string): SourceRow[] {
  let parsed: string[][];
  try {
    parsed = parse(csvText, {
      bom: true,
      relax_column_count: false,
      skip_empty_lines: true,
    }) as string[][];
  } catch {
    throw new Error("Historical CSV structure is invalid");
  }
  const [headers, ...values] = parsed;
  if (!headers || headers.length !== SOURCE_HEADERS.length ||
      headers.some((header, index) => header !== SOURCE_HEADERS[index]) || !values.length) {
    throw new Error("Historical CSV headers are invalid");
  }
  return values.map((value) => {
    if (value.length !== SOURCE_HEADERS.length || !/^[0-6]$/.test(value[1].trim())) {
      throw new Error("Historical CSV rows are invalid");
    }
    const row = Object.fromEntries(SOURCE_HEADERS.map((header, index) =>
      [header, value[index] ?? ""]
    )) as unknown as SourceRow;
    row.position = Number(value[1].trim());
    return row;
  });
}

function validateReviewedIds(values: string[]): Set<string> {
  if (!Array.isArray(values) || !values.length) {
    throw new Error("Reviewed Student list is invalid");
  }
  if (values.some((value) => typeof value !== "string" || !value || value !== value.trim()) ||
      new Set(values).size !== values.length) {
    throw new Error("Reviewed Student list is invalid");
  }
  return new Set(values);
}

function transformStudentGroup(
  businessStudentId: string,
  rows: SourceRow[]
): HistoricalHolisticNoteSource {
  const positions = new Map<number, SourceRow[]>();
  for (const row of rows) {
    const grouped = positions.get(row.position) ?? [];
    grouped.push(row);
    positions.set(row.position, grouped);
  }
  for (const position of [0, 1, 2]) {
    const identityRows = positions.get(position) ?? [];
    if (identityRows.length !== 1 || identityRows[0].question_type.trim() !== "subjective") {
      throw new Error("Historical CSV identity rows are invalid");
    }
  }
  const { startedAt, endedAt } = sourceTimes(rows);
  return {
    businessStudentId,
    sourceRecordKey: `approved_2025_holistic_export:${businessStudentId}`,
    sourceMentorId: positions.get(0)![0].user_response.trim() || null,
    sourceStartedAt: startedAt,
    sourceEndedAt: endedAt,
    sourceTimezone: HISTORICAL_SOURCE_TIMEZONE,
    questions: [3, 4, 5, 6].map((sourcePosition, index) =>
      transformQuestion(positions.get(sourcePosition) ?? [], index + 1)
    ),
  };
}

function sourceTimes(rows: SourceRow[]): { startedAt: string; endedAt: string | null } {
  const startedAt = singleSourceValue(rows.map((row) => row.start_quiz_time.trim()));
  const sourceEnd = singleSourceValue(rows.map((row) => row.end_quiz_time.trim()));
  if (!startedAt || sourceEnd === null) {
    throw new Error("Historical CSV source timestamps are invalid");
  }
  const endedAt = sourceEnd || null;
  if (!hasValidHistoricalSourceProvenance({
    sourceStartedAt: startedAt,
    sourceEndedAt: endedAt,
    sourceTimezone: HISTORICAL_SOURCE_TIMEZONE,
  })) {
    throw new Error("Historical CSV source timestamps are invalid");
  }
  return {
    startedAt,
    endedAt,
  };
}

function singleSourceValue(values: string[]): string | null {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

function transformQuestion(
  rows: SourceRow[],
  targetPosition: number
): HistoricalHolisticNoteSource["questions"][number] {
  if (!rows.length || rows.some((row) => row.question_type.trim() !== "matrix-subjective")) {
    throw new Error("Historical CSV Question rows are invalid");
  }
  const question = sourceQuestionText(rows);
  const answers = matrixAnswers(rows);
  return {
    position: targetPosition,
    question,
    answer: answers.length ? answers.join("\n") : null,
  };
}

function sourceQuestionText(rows: SourceRow[]): string {
  const questions = new Set(rows.map((row) => row.question_text.trim()));
  if (questions.size !== 1 || ![...questions][0]) {
    throw new Error("Historical CSV Question rows are invalid");
  }
  return [...questions][0];
}

function matrixAnswers(rows: SourceRow[]): string[] {
  const options = new Set<string>();
  const values = rows.map((row) => matrixAnswer(row, options));
  const answers = values.filter((value): value is string => value !== null);
  if (answers.length && answers.length !== values.length) {
    throw new Error("Historical CSV matrix rows are invalid");
  }
  return answers;
}

function matrixAnswer(row: SourceRow, options: Set<string>): string | null {
  const option = row.matrix_option.trim();
  const response = row.matrix_response.trim();
  if (!option && !response) return null;
  if (!option || !response || options.has(option)) {
    throw new Error("Historical CSV matrix rows are invalid");
  }
  options.add(option);
  return `${option}: ${response}`;
}
