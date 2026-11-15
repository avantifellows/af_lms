import { defineConfig } from "@playwright/test";

const TEST_PORT = 3001;
// e2e/helpers/db-service-stub.mjs: no spec may reach a real DB Service.
const DB_SERVICE_STUB_PORT = 3902;
const DB_SERVICE_STUB_TOKEN = "e2e-db-service-token";

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "monocart-reporter",
      {
        name: "E2E Coverage Report",
        outputFile: "./monocart-report/index.html",
        coverage: {
          outputDir: "./coverage",
          // fallow-ignore-next-line complexity
          entryFilter: (entry: { url: string }) => {
            const url = entry.url;
            // Only include our app's chunks, not Next.js internals/HMR/devtools
            if (url.includes("node_modules")) return false;
            if (url.includes("[turbopack]")) return false;
            if (url.includes("_next/static/chunks/webpack")) return false;
            if (url.includes("_next/static/chunks/polyfills")) return false;
            return url.includes("af_lms");
          },
          sourceFilter: (sourcePath: string) => {
            // Only include our app's source files, not Next.js internals
            if (sourcePath.startsWith("next/")) return false;
            if (sourcePath.includes("node_modules")) return false;
            return sourcePath.includes("af_lms/src/") || sourcePath.includes("/src/");
          },
          reports: [
            ["console-details", { skipPercent: 80 }],
            ["v8"],
            ["json-summary"],
          ],
        },
      },
    ],
  ],
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
  webServer: [
    {
      command: "node e2e/helpers/db-service-stub.mjs",
      url: `http://localhost:${DB_SERVICE_STUB_PORT}/__health`,
      reuseExistingServer: false,
      timeout: 15_000,
      env: { E2E_DB_SERVICE_PORT: String(DB_SERVICE_STUB_PORT), E2E_DB_SERVICE_TOKEN: DB_SERVICE_STUB_TOKEN },
    },
    {
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
        // Blended Learning photos are presigned locally against a fake bucket;
        // specs answer the S3 GETs themselves.
        S3_DOCS_BUCKET: "e2e-fake-docs",
        S3_DOCS_PREFIX: "lms-documents",
        S3_DOCS_REGION: "ap-south-1",
        S3_DOCS_ACCESS_KEY_ID: "e2e-fake-access-key",
        S3_DOCS_SECRET_ACCESS_KEY: "e2e-fake-secret-key",
        // The well-being notifier stays unconfigured, so no email is sent. A
        // blank value would be dropped and refilled from .env.local; the
        // notifier trims these to empty and skips.
        BLENDED_LEARNING_SES_ACCESS_KEY_ID: " ",
        BLENDED_LEARNING_WELLBEING_EMAILS: " ",
        // etl-next is unconfigured too, so a new draft is never woken and stays
        // transcribing.
        BLENDED_LEARNING_ETL_URL: " ",
        BLENDED_LEARNING_ETL_TOKEN: " ",
        // BigQuery stays unavailable, so server-rendered pages never query the
        // warehouse from .env.local credentials (the Visit Summary School page
        // shows "Academic levels unavailable"). Specs stub /api/quiz-analytics.
        GOOGLE_SERVICE_ACCOUNT_JSON: " ",
        DB_SERVICE_URL: `http://localhost:${DB_SERVICE_STUB_PORT}/api`,
        DB_SERVICE_TOKEN: DB_SERVICE_STUB_TOKEN,
      },
    },
  ],
});
