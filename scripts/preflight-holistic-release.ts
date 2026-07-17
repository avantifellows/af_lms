import * as dotenv from "dotenv";
import { readFile } from "node:fs/promises";

function value(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const historicalSource = value(args, "--historical-source");
  if (!args.includes("--confirm-production-read-only") || !historicalSource) {
    throw new Error("--confirm-production-read-only and --historical-source=<private-json-export> are required");
  }
  dotenv.config({ path: value(args, "--env-file") ?? ".env.production", quiet: true });

  const historical = JSON.parse(await readFile(historicalSource, "utf8")) as unknown;
  if (!Array.isArray(historical) || historical.some((row) =>
    !row || typeof row !== "object" || typeof (row as { businessStudentId?: unknown }).businessStudentId !== "string"
  )) {
    throw new Error("Historical source must be the grouped private JSON export");
  }

  const [{ getBigQueryClient }, release, db] = await Promise.all([
    import("../src/lib/bigquery"),
    import("../src/lib/holistic-release"),
    import("../src/lib/db"),
  ]);
  const project = process.env.HOLISTIC_PROFILE_BQ_PROJECT ?? "avantifellows";
  const dataset = process.env.HOLISTIC_PROFILE_BQ_DATASET ?? "assessments";
  if (!/^[A-Za-z0-9_-]+$/.test(project) || !/^[A-Za-z0-9_]+$/.test(dataset)) {
    throw new Error("Invalid BigQuery project or dataset");
  }
  const [sourceRows] = await getBigQueryClient().query({
    query: `SELECT user_id, test_id, session_id, question_id, question_position_index, question_set_title
            FROM \`${project}.${dataset}.all_responses_form_level\`
            WHERE test_type = 'form'
              AND ((test_id = @grade11Form AND session_id = @grade11Session)
                OR (test_id = @grade12Form AND session_id = @grade12Session))
            ORDER BY user_id, test_id, question_position_index, question_id`,
    params: {
      grade11Form: release.APPROVED_PROFILE_FORMS[11].formId,
      grade11Session: release.APPROVED_PROFILE_FORMS[11].sessionId,
      grade12Form: release.APPROVED_PROFILE_FORMS[12].formId,
      grade12Session: release.APPROVED_PROFILE_FORMS[12].sessionId,
    },
  });
  const evidence = release.buildHolisticProfileSourceEvidence(
    sourceRows as Parameters<typeof release.buildHolisticProfileSourceEvidence>[0],
    historical.map((row) => (row as { businessStudentId: string }).businessStudentId)
  );

  try {
    const report = await db.withTransaction(async (client) => {
      await client.query("SET TRANSACTION READ ONLY");
      return release.runHolisticReleasePreflight({
        academicYear: value(args, "--academic-year") ?? "2026-2027",
        profileSource: evidence,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Holistic release preflight failed");
  process.exitCode = 1;
});
