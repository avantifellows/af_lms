import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

import { dropDatabase } from "./helpers/db";

export default async function globalTeardown() {
  console.log("[e2e] Dropping test database...");
  await dropDatabase();
  console.log("[e2e] Cleanup complete.");
}
