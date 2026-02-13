import { defineConfig } from "@playwright/test";

const TEST_PORT = 3001;

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "html",
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: `npx next dev --port ${TEST_PORT}`,
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      DATABASE_HOST: "localhost",
      DATABASE_PORT: "5432",
      DATABASE_USER: process.env.TEST_DB_USER || "postgres",
      DATABASE_PASSWORD: process.env.TEST_DB_PASSWORD || "postgres",
      DATABASE_NAME: "af_lms_test",
      DATABASE_SSL: "false",
      NEXTAUTH_SECRET: "e2e-test-secret-at-least-32-chars-long",
      NEXTAUTH_URL: `http://localhost:${TEST_PORT}`,
      GOOGLE_CLIENT_ID: "fake-client-id",
      GOOGLE_CLIENT_SECRET: "fake-client-secret",
      NEXT_TEST_MODE: "1",
    },
  },
});
