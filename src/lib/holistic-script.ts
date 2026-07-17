import * as dotenv from "dotenv";

import type {
  HistoricalHolisticNoteSource,
  HolisticOperationMode,
} from "./holistic-operations";

export function getHolisticScriptArgument(
  args: string[],
  name: string
): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
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
    isNullableString(record.sourceMentorId);
}

function hasValidQuestions(value: unknown): boolean {
  return Array.isArray(value) && value.every(isSourceQuestion);
}

function isSourceQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.position) &&
    typeof value.question === "string" &&
    isNullableString(value.answer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
