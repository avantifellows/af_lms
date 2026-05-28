import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

import { dropDatabase } from "./helpers/db";
import { stopMockDbServiceServer } from "./helpers/mock-db-service";

export default async function globalTeardown() {
  console.log("[e2e] Dropping test database...");
  await dropDatabase();
  console.log("[e2e] Stopping mock db-service...");
  await stopMockDbServiceServer();
  console.log("[e2e] Cleanup complete.");
}
