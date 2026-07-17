import { createHash } from "node:crypto";

export type HolisticOperationMode = "dry-run" | "apply";

export interface HistoricalHolisticNoteSource {
  businessStudentId: string;
  sourceRecordKey: string;
  sourceMentorId: string | null;
  questions: Array<{
    position: number;
    question: string;
    answer: string | null;
  }>;
}

export interface ResolvedHistoricalStudent {
  businessStudentId: string;
  studentId: number;
  mentorUserId: number | null;
  eligible: boolean;
}

export interface HistoricalImportSource {
  read(): Promise<HistoricalHolisticNoteSource[]>;
}

export interface HistoricalImportDb {
  resolve(source: HistoricalHolisticNoteSource[]): Promise<ResolvedHistoricalStudent[]>;
  existing(studentIds: number[], sourceSystem: string): Promise<Set<number>>;
  insert(records: HistoricalImportWrite[]): Promise<void>;
}

export interface HistoricalImportWrite {
  studentId: number;
  mentorUserId: number | null;
  sourceRecordKey: string;
  sourceFingerprint: string;
  sourceSnapshot: string;
  actorUserId: number;
  questions: HistoricalHolisticNoteSource["questions"];
}

export interface HistoricalImportReport {
  ok: boolean;
  mode: HolisticOperationMode;
  blockers: string[];
  counts: {
    safeCandidates: number;
    writes: number;
    emptySkips: number;
    nullableMentors: number;
    quarantinedUnmatched: number;
  };
}

const HISTORICAL_SOURCE_SYSTEM = "approved_2025_holistic_export";
const APPROVED_BASELINE = {
  safeCandidates: 42,
  substantive: 39,
  emptySkips: 3,
  nullableMentors: 10,
  quarantinedUnmatched: 11,
};

export async function runHistoricalHolisticNotesImport(params: {
  mode?: HolisticOperationMode;
  source: HistoricalImportSource;
  db: HistoricalImportDb;
  actorUserId?: number;
  sourceSnapshot?: string;
}): Promise<HistoricalImportReport> {
  const mode = params.mode ?? "dry-run";
  const source = await params.source.read();
  const resolvedRows = await params.db.resolve(source);
  const byBusinessId = new Map<string, ResolvedHistoricalStudent[]>();
  for (const row of resolvedRows) {
    const matches = byBusinessId.get(row.businessStudentId) ?? [];
    matches.push(row);
    byBusinessId.set(row.businessStudentId, matches);
  }

  const blockers: string[] = [];
  if (source.some((row) => row.questions.length !== 4 ||
      row.questions.some((question, index) => question.position !== index + 1))) {
    blockers.push("Source records must contain Question positions 1, 2, 3, and 4 exactly once");
  }
  const safe = source.filter((row) => {
    const matches = byBusinessId.get(row.businessStudentId) ?? [];
    return matches.length === 1 && matches[0].eligible;
  });
  const wrongScope = source.filter((row) => {
    const matches = byBusinessId.get(row.businessStudentId) ?? [];
    return matches.length === 1 && !matches[0].eligible;
  }).length;
  const ambiguous = source.length - safe.length - source.filter(
    (row) => !byBusinessId.has(row.businessStudentId)
  ).length - wrongScope;
  const unmatched = source.filter((row) => !byBusinessId.has(row.businessStudentId)).length;
  if (ambiguous) blockers.push(`${ambiguous} source Student IDs are ambiguous`);
  if (wrongScope) blockers.push(`${wrongScope} source Students are outside the approved current roster`);

  const substantive = safe.filter((row) => row.questions.some(({ answer }) => answer?.trim()));
  const nullableMentors = substantive.filter(
    (row) => byBusinessId.get(row.businessStudentId)?.[0].mentorUserId == null
  ).length;
  const counts = {
    safeCandidates: safe.length,
    writes: substantive.length,
    emptySkips: safe.length - substantive.length,
    nullableMentors,
    quarantinedUnmatched: unmatched,
  };
  if (
    counts.safeCandidates !== APPROVED_BASELINE.safeCandidates ||
    substantive.length !== APPROVED_BASELINE.substantive ||
    counts.emptySkips !== APPROVED_BASELINE.emptySkips ||
    counts.nullableMentors !== APPROVED_BASELINE.nullableMentors ||
    counts.quarantinedUnmatched !== APPROVED_BASELINE.quarantinedUnmatched
  ) {
    blockers.push("Reconciliation counts differ from the approved 42/39/3/10/11 baseline");
  }
  if (mode === "apply" && (!params.actorUserId || !params.sourceSnapshot?.trim())) {
    blockers.push("Apply requires actor and source-snapshot metadata");
  }

  const resolved = substantive.map((row) => ({ row, match: byBusinessId.get(row.businessStudentId)![0] }));
  const existing = await params.db.existing(resolved.map(({ match }) => match.studentId), HISTORICAL_SOURCE_SYSTEM);
  const writes = resolved.filter(({ match }) => !existing.has(match.studentId)).map(({ row, match }) => ({
    studentId: match.studentId,
    mentorUserId: match.mentorUserId,
    sourceRecordKey: row.sourceRecordKey,
    sourceFingerprint: createHash("sha256").update(JSON.stringify(row)).digest("hex"),
    sourceSnapshot: params.sourceSnapshot ?? "dry-run",
    actorUserId: params.actorUserId ?? 0,
    questions: row.questions,
  }));
  counts.writes = writes.length;
  if (mode === "apply" && blockers.length === 0) await params.db.insert(writes);
  return { ok: blockers.length === 0, mode, blockers, counts };
}

export interface HolisticRolloverCandidate {
  studentId: number;
  mentorUserId: number;
  schoolId: number;
  eligible: boolean;
  alreadyMapped: boolean;
}

export interface HolisticRolloverDb {
  candidates(fromAcademicYear: string, toAcademicYear: string): Promise<HolisticRolloverCandidate[]>;
  apply(fromAcademicYear: string, toAcademicYear: string, actorUserId: number): Promise<HolisticRolloverCounts>;
}

export type HolisticRolloverCounts = { carried: number; skipped: number; ineligible: number };

export async function runHolisticMappingRollover(params: {
  mode?: HolisticOperationMode;
  fromAcademicYear: string;
  toAcademicYear: string;
  actorUserId: number;
  db: HolisticRolloverDb;
}): Promise<{
  ok: true;
  mode: HolisticOperationMode;
  counts: HolisticRolloverCounts;
}> {
  const fromStart = academicYearStart(params.fromAcademicYear);
  const toStart = academicYearStart(params.toAcademicYear);
  if (fromStart === null || toStart !== fromStart + 1) {
    throw new Error("Rollover target must be the next Academic Year");
  }
  const mode = params.mode ?? "dry-run";
  if (mode === "apply") {
    return {
      ok: true,
      mode,
      counts: await params.db.apply(params.fromAcademicYear, params.toAcademicYear, params.actorUserId),
    };
  }
  const candidates = await params.db.candidates(params.fromAcademicYear, params.toAcademicYear);
  const carried = candidates.filter((candidate) => candidate.eligible && !candidate.alreadyMapped);
  const counts = {
    carried: carried.length,
    skipped: candidates.filter((candidate) => candidate.alreadyMapped).length,
    ineligible: candidates.filter((candidate) => !candidate.eligible && !candidate.alreadyMapped).length,
  };
  return { ok: true, mode, counts };
}

function academicYearStart(value: string): number | null {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return match && Number(match[2]) === Number(match[1]) + 1 ? Number(match[1]) : null;
}
