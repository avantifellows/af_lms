import { test as base, type Page, type TestInfo } from "@playwright/test";
import { addCoverageReport } from "monocart-reporter";
import { encode } from "next-auth/jwt";
import { TEST_USERS, type TestUserRole } from "../helpers/test-users";

const NEXTAUTH_SECRET = "e2e-test-secret-at-least-32-chars-long";
const COOKIE_NAME = "next-auth.session-token";

interface TokenPayload {
  name: string;
  email: string;
  sub: string;
  schoolCode?: string;
  isPasscodeUser?: boolean;
  [key: string]: unknown;
}

async function createSessionCookie(payload: TokenPayload): Promise<string> {
  const token = await encode({
    token: payload,
    secret: NEXTAUTH_SECRET,
  });
  return token;
}

async function authenticatedPage(
  page: Page,
  payload: TokenPayload
): Promise<Page> {
  const token = await createSessionCookie(payload);

  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  return page;
}

function googleUserPayload(role: TestUserRole): TokenPayload {
  const user = TEST_USERS[role];
  return {
    name: `E2E ${role}`,
    email: user.email,
    sub: `e2e-${role}-sub`,
  };
}

async function startCoverage(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === "chromium") {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
  }
}

async function stopCoverage(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === "chromium") {
    const coverage = await page.coverage.stopJSCoverage();
    if (coverage.length > 0) {
      await addCoverageReport(coverage, testInfo);
    }
  }
}

// Extend Playwright test with per-role page fixtures + auto-coverage
export const test = base.extend<{
  autoTestFixture: void;
  adminPage: Page;
  pmPage: Page;
  teacherPage: Page;
  passcodePage: Page;
}>({
  // Auto-fixture: collects V8 JS coverage for default page (Chromium only)
  autoTestFixture: [
    async ({ page }, use, testInfo) => {
      await startCoverage(page, testInfo);
      await use();
      await stopCoverage(page, testInfo);
    },
    { scope: "test", auto: true },
  ],

  adminPage: async ({ page }, use) => {
    await authenticatedPage(page, googleUserPayload("admin"));
    await use(page);
  },
  pmPage: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticatedPage(page, googleUserPayload("pm"));
    await startCoverage(page, testInfo);
    await use(page);
    await stopCoverage(page, testInfo);
    await context.close();
  },
  teacherPage: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticatedPage(page, googleUserPayload("teacher"));
    await startCoverage(page, testInfo);
    await use(page);
    await stopCoverage(page, testInfo);
    await context.close();
  },
  passcodePage: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticatedPage(page, {
      name: "School 70705",
      email: "passcode-70705@school.local",
      sub: "passcode-70705",
      schoolCode: "70705",
      isPasscodeUser: true,
    });
    await startCoverage(page, testInfo);
    await use(page);
    await stopCoverage(page, testInfo);
    await context.close();
  },
});

export { expect } from "@playwright/test";
