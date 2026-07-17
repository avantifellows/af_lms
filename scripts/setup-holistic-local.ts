import path from "node:path";

import {
  configureHolisticScriptEnvironment,
  getHolisticScriptArgument,
  runHolisticScript,
} from "../src/lib/holistic-script";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbServicePath = parseDbServicePath(args);
  configureHolisticScriptEnvironment(args, ".env.local");
  const databaseUrl = getLocalDatabaseUrl();
  const fixtures = await import("../src/lib/holistic-fixtures");
  fixtures.applyHolisticDbServiceSchema({ dbServicePath, databaseUrl });

  const db = await import("../src/lib/db");
  try {
    const report = await db.withTransaction((client) => fixtures.seedHolisticFixtures(client));
    console.log(JSON.stringify({ ...report, manifest: fixtures.HOLISTIC_FIXTURE_MANIFEST }, null, 2));
  } finally {
    await db.default.end();
  }
}

function parseDbServicePath(args: string[]): string {
  if (!args.includes("--confirm-synthetic-database")) {
    throw new Error("--confirm-synthetic-database is required");
  }
  return path.resolve(
    getHolisticScriptArgument(args, "--db-service-path") ?? "../db-service_holistic_mentorship"
  );
}

function getLocalDatabaseUrl(): string {
  const {
    DATABASE_HOST: host = "localhost",
    DATABASE_PORT: port = "5432",
    DATABASE_USER: user = "postgres",
    DATABASE_PASSWORD: password = "postgres",
    DATABASE_NAME: database,
  } = process.env;
  if (!database || !LOCAL_DATABASE_HOSTS.has(host)) {
    throw new Error("Holistic fixture setup is restricted to an explicit local database");
  }
  return `ecto://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;
}

runHolisticScript(main, "Holistic local setup failed");
