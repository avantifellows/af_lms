import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  assertApprovedHistoricalSourceCounts,
  transformHistoricalHolisticSourceCsv,
} from "../src/lib/holistic-historical-source";
import { writePrivateFileAtomically } from "../src/lib/private-file";
import {
  getHolisticScriptArgument,
  runHolisticScript,
} from "../src/lib/holistic-script";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourcePath = requireArgument(args, "--source-csv");
  const reviewedIdsPath = requireArgument(args, "--reviewed-student-ids");
  const outputPath = requireArgument(args, "--output");
  const [csvText, reviewedIdsText] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(reviewedIdsPath, "utf8"),
  ]);
  const reviewedStudentIds = parseReviewedStudentIds(reviewedIdsText);
  const { records, counts } = transformHistoricalHolisticSourceCsv(
    csvText,
    reviewedStudentIds
  );
  assertApprovedHistoricalSourceCounts(counts);
  await writePrivateFileAtomically(
    outputPath,
    `${JSON.stringify(records, null, 2)}\n`
  );

  const sourceSnapshot = `sha256:${createHash("sha256").update(csvText).digest("hex")}`;
  console.log(JSON.stringify({ ok: true, counts, sourceSnapshot }));
}

function requireArgument(args: string[], name: string): string {
  const value = getHolisticScriptArgument(args, name);
  if (!value?.trim()) throw new Error("Historical source preparation requires all private file arguments");
  return value;
}

function parseReviewedStudentIds(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) =>
    typeof item === "string" && item.trim().length > 0)) {
    throw new Error("Reviewed Student IDs must be a JSON string array");
  }
  if (parsed.length !== 53) {
    throw new Error("Reviewed Student ID count differs from the approved cohort");
  }
  return parsed as string[];
}

runHolisticScript(main, "Historical source preparation failed");
