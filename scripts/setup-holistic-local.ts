import * as dotenv from "dotenv";
import path from "node:path";

function value(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes("--confirm-synthetic-database")) {
    throw new Error("--confirm-synthetic-database is required");
  }
  dotenv.config({ path: value(args, "--env-file") ?? ".env.local", quiet: true });
  const host = process.env.DATABASE_HOST ?? "localhost";
  const port = process.env.DATABASE_PORT ?? "5432";
  const user = process.env.DATABASE_USER ?? "postgres";
  const password = process.env.DATABASE_PASSWORD ?? "postgres";
  const database = process.env.DATABASE_NAME;
  if (!database || !["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Holistic fixture setup is restricted to an explicit local database");
  }
  const databaseUrl = `ecto://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
  const fixtures = await import("../src/lib/holistic-fixtures");
  fixtures.applyHolisticDbServiceSchema({
    dbServicePath: path.resolve(value(args, "--db-service-path") ?? "../db-service_holistic_mentorship"),
    databaseUrl,
  });

  const db = await import("../src/lib/db");
  try {
    const report = await db.withTransaction((client) => fixtures.seedHolisticFixtures(client));
    console.log(JSON.stringify({ ...report, manifest: fixtures.HOLISTIC_FIXTURE_MANIFEST }, null, 2));
  } finally {
    await db.default.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Holistic local setup failed");
  process.exitCode = 1;
});
