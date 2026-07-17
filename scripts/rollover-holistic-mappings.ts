import * as dotenv from "dotenv";

function value(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--apply") && args.includes("--dry-run")) {
    throw new Error("Use either --apply or --dry-run, not both");
  }
  const mode = args.includes("--apply") ? "apply" : "dry-run";
  const fromAcademicYear = value(args, "--from");
  const toAcademicYear = value(args, "--to");
  const actorUserId = Number(value(args, "--actor-user-id"));
  const academicYearPattern = /^\d{4}-\d{4}$/;
  if (!fromAcademicYear || !toAcademicYear || !academicYearPattern.test(fromAcademicYear) ||
      !academicYearPattern.test(toAcademicYear) || !Number.isSafeInteger(actorUserId) || actorUserId < 1) {
    throw new Error("--from, --to, and --actor-user-id are required");
  }
  dotenv.config({ path: value(args, "--env-file") ?? ".env.local", quiet: true });
  const [{ runHolisticMappingRollover }, { holisticRolloverDb }, db] = await Promise.all([
    import("../src/lib/holistic-operations"),
    import("../src/lib/holistic-operations-db"),
    import("../src/lib/db"),
  ]);
  try {
    console.log(JSON.stringify(await runHolisticMappingRollover({
      mode, fromAcademicYear, toAcademicYear, actorUserId, db: holisticRolloverDb,
    })));
  } finally {
    await db.default.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Mapping rollover failed");
  process.exitCode = 1;
});
