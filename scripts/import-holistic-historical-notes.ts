import * as dotenv from "dotenv";
import { readFile } from "node:fs/promises";

import type { HistoricalHolisticNoteSource } from "../src/lib/holistic-operations";

function value(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourcePath = value(args, "--source");
  if (args.includes("--apply") && args.includes("--dry-run")) {
    throw new Error("Use either --apply or --dry-run, not both");
  }
  const mode = args.includes("--apply") ? "apply" : "dry-run";
  const actorUserId = Number(value(args, "--actor-user-id"));
  const sourceSnapshot = value(args, "--source-snapshot");
  if (!sourcePath) throw new Error("--source=<private-json-export> is required");
  if (mode === "apply" && (!Number.isSafeInteger(actorUserId) || actorUserId < 1 || !sourceSnapshot)) {
    throw new Error("Apply requires --actor-user-id and --source-snapshot");
  }
  dotenv.config({ path: value(args, "--env-file") ?? ".env.local", quiet: true });
  const parsed: unknown = JSON.parse(await readFile(sourcePath, "utf8"));
  if (!Array.isArray(parsed) || parsed.some((record) => !isSourceRecord(record))) {
    throw new Error("Source must be a JSON array of grouped Historical Notes records");
  }
  const source: HistoricalHolisticNoteSource[] = parsed;
  const [{ runHistoricalHolisticNotesImport }, { historicalImportDb }, db] = await Promise.all([
    import("../src/lib/holistic-operations"),
    import("../src/lib/holistic-operations-db"),
    import("../src/lib/db"),
  ]);
  try {
    const report = await runHistoricalHolisticNotesImport({
      mode, actorUserId, sourceSnapshot, source: { read: async () => source }, db: historicalImportDb,
    });
    console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await db.default.end();
  }
}

function isSourceRecord(value: unknown): value is HistoricalHolisticNoteSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.businessStudentId === "string" && record.businessStudentId.length > 0 &&
    typeof record.sourceRecordKey === "string" && record.sourceRecordKey.length > 0 &&
    (record.sourceMentorId === null || typeof record.sourceMentorId === "string") &&
    Array.isArray(record.questions) && record.questions.every((question) => {
      if (!question || typeof question !== "object" || Array.isArray(question)) return false;
      const item = question as Record<string, unknown>;
      return Number.isInteger(item.position) && typeof item.question === "string" &&
        (item.answer === null || typeof item.answer === "string");
    });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Historical import failed");
  process.exitCode = 1;
});
