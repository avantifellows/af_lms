import { createHolisticOperationsDb } from "../src/lib/holistic-operations-db";
import { runHolisticMappingRollover } from "../src/lib/holistic-operations";
import {
  configureHolisticScriptEnvironment,
  getHolisticOperationMode,
  getHolisticScriptArgument,
  runHolisticScript,
} from "../src/lib/holistic-script";
import { isHolisticMentorshipProgramId, PROGRAM_IDS } from "../src/lib/constants";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseOptions(args);
  configureHolisticScriptEnvironment(args, ".env.local");
  const db = await import("../src/lib/db");
  const operationsDb = createHolisticOperationsDb(db);

  try {
    const report = await runHolisticMappingRollover({
      ...options,
      db: operationsDb.rollover,
    });
    console.log(JSON.stringify(report));
  } finally {
    await db.default.end();
  }
}

function parseOptions(args: string[]) {
  const mode = getHolisticOperationMode(args);
  const fromAcademicYear = getHolisticScriptArgument(args, "--from");
  const toAcademicYear = getHolisticScriptArgument(args, "--to");
  const actorUserId = Number(getHolisticScriptArgument(args, "--actor-user-id"));
  const programId = Number(
    getHolisticScriptArgument(args, "--program-id") ?? PROGRAM_IDS.COE
  );
  if (!fromAcademicYear || !toAcademicYear) throw invalidOptionsError();
  validateOptions(fromAcademicYear, toAcademicYear, actorUserId, programId);
  return { mode, fromAcademicYear, toAcademicYear, actorUserId, programId };
}

function validateOptions(
  fromAcademicYear: string,
  toAcademicYear: string,
  actorUserId: number,
  programId: number
): void {
  if (!isAcademicYear(fromAcademicYear) ||
      !isAcademicYear(toAcademicYear) ||
      !isPositiveSafeInteger(actorUserId) ||
      !isHolisticMentorshipProgramId(programId)) {
    throw invalidOptionsError();
  }
}

function invalidOptionsError(): Error {
  return new Error("--from, --to, --actor-user-id, and a supported --program-id are required");
}

function isAcademicYear(value: string): boolean {
  return /^\d{4}-\d{4}$/.test(value);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

runHolisticScript(main, "Mapping rollover failed");
