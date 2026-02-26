import dotenv from "dotenv";
import path from "path";

// Load .env.test before anything else
dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

import { resetDatabase } from "./helpers/db";

export default async function globalSetup() {
  console.log("[e2e] Resetting test database...");
  await resetDatabase();
  console.log("[e2e] Test database ready.");
}
