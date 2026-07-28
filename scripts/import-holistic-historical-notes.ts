import { readFile } from "node:fs/promises";

import { createHolisticOperationsDb } from "../src/lib/holistic-operations-db";
import { runHistoricalHolisticNotesImport } from "../src/lib/holistic-operations";
import type { HistoricalHolisticNoteSource } from "../src/lib/holistic-operations";
import { isHolisticMentorshipProgramId, PROGRAM_IDS } from "../src/lib/constants";
import {
  configureHolisticScriptEnvironment,
  getHistoricalImportBaseline,
  getHolisticOperationMode,
  getHolisticScriptArgument,
  isHistoricalHolisticNotesSource,
  runHolisticScript,
} from "../src/lib/holistic-script";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseOptions(args);
  configureHolisticScriptEnvironment(args, ".env.local");
  const source = await readSource(options.sourcePath);
  const db = await import("../src/lib/db");
  const operationsDb = createHolisticOperationsDb(db);

  try {
    const report = await runHistoricalHolisticNotesImport({
      mode: options.mode,
      actorUserId: options.actorUserId,
      sourceSnapshot: options.sourceSnapshot,
      programId: options.programId,
      approvedBaseline: options.approvedBaseline,
      source: { read: async () => source },
      db: operationsDb.historicalImport,
    });
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await db.default.end();
  }
}

function parseOptions(args: string[]) {
  const mode = getHolisticOperationMode(args);
  const sourcePath = getHolisticScriptArgument(args, "--source");
  if (!sourcePath) throw new Error("--source=<private-json-export> is required");

  const actorUserId = Number(getHolisticScriptArgument(args, "--actor-user-id"));
  const sourceSnapshot = getHolisticScriptArgument(args, "--source-snapshot");
  const programId = Number(
    getHolisticScriptArgument(args, "--program-id") ?? PROGRAM_IDS.COE
  );
  if (!isHolisticMentorshipProgramId(programId)) {
    throw new Error("--program-id must be 1 or 78");
  }
  const approvedBaseline = getHistoricalImportBaseline(args);
  if (mode === "apply") {
    validateApplyOptions(actorUserId, sourceSnapshot, programId, approvedBaseline);
  }
  return {
    mode,
    actorUserId,
    sourceSnapshot,
    sourcePath,
    programId,
    approvedBaseline,
  };
}

function validateApplyOptions(
  actorUserId: number,
  sourceSnapshot: string | undefined,
  programId: number,
  approvedBaseline: ReturnType<typeof getHistoricalImportBaseline>
): void {
  if (!Number.isSafeInteger(actorUserId) || actorUserId < 1 || !sourceSnapshot) {
    throw new Error("Apply requires --actor-user-id and --source-snapshot");
  }
  if (programId === PROGRAM_IDS.EMRS_COE && !approvedBaseline) {
    throw new Error("Program 78 apply requires --approved-counts from its reviewed dry-run");
  }
}

async function readSource(sourcePath: string): Promise<HistoricalHolisticNoteSource[]> {
  const parsed: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
  if (!isHistoricalHolisticNotesSource(parsed)) {
    throw new Error("Source must be a JSON array of grouped Historical Notes records");
  }
  return parsed;
}

runHolisticScript(main, "Historical import failed");
