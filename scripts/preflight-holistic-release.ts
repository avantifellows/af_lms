import { readFile } from "node:fs/promises";

import {
  buildHolisticProfileSourceEvidence,
  buildHolisticProfileSourceQuery,
  runHolisticReleasePreflight,
} from "../src/lib/holistic-release";
import {
  configureHolisticScriptEnvironment,
  getHolisticScriptArgument,
  runHolisticScript,
} from "../src/lib/holistic-script";
import { isHolisticMentorshipProgramId, PROGRAM_IDS } from "../src/lib/constants";

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
  const historicalSource = getHolisticScriptArgument(args, "--historical-source");
  const programId = Number(
    getHolisticScriptArgument(args, "--program-id") ?? PROGRAM_IDS.COE
  );
  if (
    !args.includes("--confirm-production-read-only") ||
    !isHolisticMentorshipProgramId(programId) ||
    (programId === PROGRAM_IDS.COE && !historicalSource)
  ) {
    throw new Error(
      "--confirm-production-read-only, a supported --program-id, and Program 1's --historical-source are required"
    );
  }
  return {
    historicalSource: historicalSource ?? null,
    programId,
    academicYear: getHolisticScriptArgument(args, "--academic-year") ?? "2026-2027",
  };
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
