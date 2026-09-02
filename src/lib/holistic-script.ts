import * as dotenv from "dotenv";

import {
  isHolisticHistoricalImportProgramId,
  isHolisticMentorshipProgramId,
  HOLISTIC_MENTORSHIP_PROGRAM_IDS,
  PROGRAM_IDS,
} from "./constants";
import { hasValidHistoricalSourceProvenance } from "./holistic-historical-provenance";
import { isValidHistoricalImportBaseline } from "./holistic-operations";
import type {
  HistoricalImportBaseline,
  HistoricalHolisticNoteSource,
  HolisticOperationMode,
} from "./holistic-operations";

export function getHolisticScriptArgument(
  args: string[],
  name: string
): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function requireHolisticScriptArgument(
  args: string[],
  name: string,
  errorMessage: string,
): string {
  const value = getHolisticScriptArgument(args, name);
  if (!value) throw new Error(errorMessage);
  return value;
}

export function getHolisticMentorshipProgramId(args: string[]): number {
  const programId = Number(
    getHolisticScriptArgument(args, "--program-id") ?? PROGRAM_IDS.COE
  );
  if (!isHolisticMentorshipProgramId(programId)) {
    throw new Error(
      `--program-id must be a supported Holistic Mentorship Program (${HOLISTIC_MENTORSHIP_PROGRAM_IDS.join(", ")})`
    );
  }
  return programId;
}

/**
 * Parse the narrower Program contract used by Historical Notes operations.
 * Keep this separate from the runtime parser so newly enabled live Programs
 * cannot reach a one-time import or inherit its reviewed cohort assumptions.
 */
export function getHolisticHistoricalImportProgramId(args: string[]): number {
  const programId = Number(
    getHolisticScriptArgument(args, "--program-id") ?? PROGRAM_IDS.COE
  );
  if (!isHolisticHistoricalImportProgramId(programId)) {
    throw new Error("--program-id must be 1 or 78 for Historical Notes operations");
  }
  return programId;
}

export function configureHolisticScriptEnvironment(
  args: string[],
  defaultPath: string
): void {
  dotenv.config({
    path: getHolisticScriptArgument(args, "--env-file") ?? defaultPath,
    quiet: true,
  });
}

export function getHolisticOperationMode(args: string[]): HolisticOperationMode {
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) {
    throw new Error("Use either --apply or --dry-run, not both");
  }
  return apply ? "apply" : "dry-run";
}

export function getHistoricalImportBaseline(
  args: string[]
): HistoricalImportBaseline | undefined {
  const raw = getHolisticScriptArgument(args, "--approved-counts");
  if (raw === undefined) return undefined;
  const segments = raw.split("/");
  const values = segments.map(Number);
  const baseline = {
    safeCandidates: values[0],
    substantive: values[1],
    emptySkips: values[2],
    nullableMentors: values[3],
    quarantinedUnmatched: values[4],
  };
  if (segments.length !== 5 || segments.some((value) => !/^\d+$/.test(value)) ||
      !isValidHistoricalImportBaseline(baseline)) {
    throw new Error(
      "--approved-counts must be safe/substantive/empty/nullable/unmatched"
    );
  }
  return baseline;
}

export function isHistoricalHolisticNotesSource(
  value: unknown
): value is HistoricalHolisticNoteSource[] {
  return Array.isArray(value) && value.every(isSourceRecord);
}

export function runHolisticScript(
  main: () => Promise<void>,
  failureMessage: string
): void {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : failureMessage);
    process.exitCode = 1;
  });
}

function isSourceRecord(value: unknown): value is HistoricalHolisticNoteSource {
  if (!isRecord(value)) return false;
  return hasSourceIdentity(value) && hasValidQuestions(value.questions);
}

function hasSourceIdentity(record: Record<string, unknown>): boolean {
  return isNonEmptyString(record.businessStudentId) &&
    isNonEmptyString(record.sourceRecordKey) &&
    isNullableString(record.sourceMentorId) &&
    hasValidHistoricalSourceProvenance({
      sourceStartedAt: record.sourceStartedAt,
      sourceEndedAt: record.sourceEndedAt,
      sourceTimezone: record.sourceTimezone,
    });
}

function hasValidQuestions(value: unknown): boolean {
  return Array.isArray(value) && value.every(isSourceQuestion);
}

function isSourceQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.position) &&
    isNonEmptyString(value.question) &&
    isNullableString(value.answer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
