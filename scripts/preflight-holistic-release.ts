import { readFile } from "node:fs/promises";

import {
  buildHolisticProfileSourceEvidence,
  buildHolisticProfileSourceQuery,
  runHolisticReleasePreflight,
} from "../src/lib/holistic-release";
import {
  configureHolisticScriptEnvironment,
  getHolisticHistoricalImportProgramId,
  getHolisticMentorshipProgramId,
  getHolisticScriptArgument,
  runHolisticScript,
} from "../src/lib/holistic-script";
import { PROGRAM_IDS } from "../src/lib/constants";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseOptions(args);
  configureHolisticScriptEnvironment(args, ".env.production");
  const historicalBusinessStudentIds = await readHistoricalBusinessStudentIds(
    options.historicalSource
  );
  const [{ getBigQueryClient }, db] = await Promise.all([
    import("../src/lib/bigquery"),
    import("../src/lib/db"),
  ]);
  const sourceQuery = buildHolisticProfileSourceQuery(
    process.env.HOLISTIC_PROFILE_BQ_PROJECT ?? "avantifellows",
    process.env.HOLISTIC_PROFILE_BQ_DATASET ?? "assessments"
  );
  const [sourceRows] = await getBigQueryClient().query(sourceQuery);
  const profileSource = buildHolisticProfileSourceEvidence(
    sourceRows as Parameters<typeof buildHolisticProfileSourceEvidence>[0],
    historicalBusinessStudentIds
  );

  try {
    const report = await db.withTransaction(async (client) => {
      await client.query("SET TRANSACTION READ ONLY");
      return runHolisticReleasePreflight({
        academicYear: options.academicYear,
        programId: options.programId,
        profileSource,
        db: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
          (await client.query<T>(sql, params)).rows,
      });
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await db.default.end();
  }
}

function parseOptions(args: string[]) {
  requireReadOnlyConfirmation(args);
  const programId = getHolisticMentorshipProgramId(args);
  const historicalSource = getHolisticScriptArgument(args, "--historical-source");
  // A preflight may cover any live Holistic Program. If it is also supplied a
  // Historical export, enforce the separate two-Program history contract
  // before dotenv/file/database I/O begins.
  if (historicalSource !== undefined) {
    getHolisticHistoricalImportProgramId(args);
  }
  requireProgramOneHistory(programId, historicalSource);
  return {
    historicalSource: historicalSource ?? null,
    programId,
    academicYear: getHolisticScriptArgument(args, "--academic-year") ?? "2026-2027",
  };
}

function requireReadOnlyConfirmation(args: string[]) {
  if (!args.includes("--confirm-production-read-only")) {
    throw new Error(
      "--confirm-production-read-only and a supported --program-id are required"
    );
  }
}

function requireProgramOneHistory(programId: number, historicalSource?: string) {
  if (programId === PROGRAM_IDS.COE && !historicalSource) {
    throw new Error(
      "--confirm-production-read-only, a supported --program-id, and Program 1's --historical-source are required"
    );
  }
}

async function readHistoricalBusinessStudentIds(sourcePath: string | null): Promise<string[]> {
  if (!sourcePath) return [];
  const parsed: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
  if (!Array.isArray(parsed) || !parsed.every(hasBusinessStudentId)) {
    throw new Error("Historical source must be the grouped private JSON export");
  }
  return parsed.map(({ businessStudentId }) => businessStudentId);
}

function hasBusinessStudentId(value: unknown): value is { businessStudentId: string } {
  return value !== null &&
    typeof value === "object" &&
    typeof (value as { businessStudentId?: unknown }).businessStudentId === "string";
}

runHolisticScript(main, "Holistic release preflight failed");
