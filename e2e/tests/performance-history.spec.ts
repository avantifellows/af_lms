import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth";

// Performance filter choices are browser history: one entry per deliberate
// choice, automatic grade picks replace, and Back/Forward restore the mounted
// tab in place. The analytics API is stubbed with fixed answers so the journey
// is deterministic; the router, URL and history are the real app's.

const OVERVIEW = {
  summary: { tests_conducted: 2, avg_participation: 0 },
  tests: [
    {
      session_id: "e2e-chapter",
      test_name: "E2E Chapter Test",
      start_date: "2026-07-01",
      student_count: 8,
      stream_student_count: 8,
      test_format: "chapter_test",
      test_stream: null,
      test_grade: 12,
      subjects: ["Physics"],
    },
    {
      session_id: "e2e-full",
      test_name: "E2E Full Test",
      start_date: "2026-07-02",
      student_count: 9,
      stream_student_count: 9,
      test_format: "full_test",
      test_stream: null,
      test_grade: 12,
      subjects: [],
    },
  ],
  totalEnrolled: 10,
  enrolledByStream: {},
  streams: ["pcm", "pcb"],
};

async function stubAnalytics(page: Page, programsFor: (program: string | null) => string[]) {
  await page.route("**/api/quiz-analytics/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/grades")) {
      const program = url.searchParams.get("program");
      await route.fulfill({ json: { grades: [11, 12], programs: programsFor(program) } });
      return;
    }
    if (url.pathname.endsWith("/batch-overview")) {
      await route.fulfill({ json: OVERVIEW });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });
}

function query(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

async function expectQuery(page: Page, expected: string) {
  await expect.poll(() => query(page).toString()).toBe(expected);
}

function button(page: Page, group: string, name: string) {
  return page.getByRole("group", { name: group, exact: true }).getByRole("button", { name, exact: true });
}

test.describe("Performance filter history", () => {
  test("Centre: Grade, category and stream choices step back and forward one at a time", async ({ adminPage: page }) => {
    // Whatever Program the Centre locks to is the only one offered.
    await stubAnalytics(page, (program) => [program ?? "JNV CoE"]);

    await page.goto("/dashboard?view=centres");
    await page.locator('a[href^="/centre/"]').first().click();
    await page.waitForURL(/\/centre\/\d+$/);
    const centrePath = new URL(page.url()).pathname;

    await page.goto(`${centrePath}?tab=performance`);
    // Grade 12 is picked automatically, by replace.
    await expectQuery(page, "tab=performance&grade=12");
    await expect(button(page, "Grade", "12")).toHaveAttribute("aria-pressed", "true");

    const scrollBefore = await page.evaluate(() => window.scrollY);

    await button(page, "Grade", "11").click();
    await expectQuery(page, "tab=performance&grade=11");
    await button(page, "Test type", "Chapter tests").click();
    await expectQuery(page, "tab=performance&grade=11&category=chapter");
    await button(page, "Stream", "PCM").click();
    await expectQuery(page, "tab=performance&grade=11&category=chapter&stream=pcm");
    await expect(button(page, "Stream", "PCM")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    await page.goBack();
    await expectQuery(page, "tab=performance&grade=11&category=chapter");
    await expect(button(page, "Stream", "All")).toHaveAttribute("aria-pressed", "true");
    await expect(button(page, "Test type", "Chapter tests")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expectQuery(page, "tab=performance&grade=11");
    await expect(button(page, "Test type", "Full tests")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expectQuery(page, "tab=performance&grade=12");
    await expect(button(page, "Grade", "12")).toHaveAttribute("aria-pressed", "true");

    await page.goForward();
    await expectQuery(page, "tab=performance&grade=11");
    await expect(button(page, "Grade", "11")).toHaveAttribute("aria-pressed", "true");
    await page.goForward();
    await expectQuery(page, "tab=performance&grade=11&category=chapter");
    await expect(button(page, "Test type", "Chapter tests")).toHaveAttribute("aria-pressed", "true");

    // Back past the landing entry leaves Performance: no automatic stops.
    await page.goBack();
    await page.goBack();
    await page.goBack();
    await page.waitForURL((url) => url.pathname === centrePath && url.search === "");
  });

  test("multi-Program School: Program and filter choices are each one history entry", async ({ adminPage: page }) => {
    await stubAnalytics(page, () => ["JNV CoE", "JNV Nodal"]);

    await page.goto("/dashboard?view=jnv-nvs");
    await page.locator('a[href^="/school/"]').first().click();
    await page.waitForURL(/\/school\/[^/?]+$/);
    const schoolPath = new URL(page.url()).pathname;

    await page.goto(`${schoolPath}?tab=performance`);
    await expect(page.getByText("Select a program to view performance data.")).toBeVisible();
    await expectQuery(page, "tab=performance&grade=12");

    await page.getByRole("button", { name: "JNV CoE", exact: true }).click();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12");
    await button(page, "Stream", "PCM").click();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12&stream=pcm");
    await page.getByRole("button", { name: "JNV Nodal", exact: true }).click();
    await expectQuery(page, "tab=performance&program=JNV+Nodal&grade=12");
    await expect(button(page, "Stream", "All")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12&stream=pcm");
    await expect(button(page, "Stream", "PCM")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12");
    await expect(button(page, "Stream", "All")).toHaveAttribute("aria-pressed", "true");

    await page.goBack();
    await expectQuery(page, "tab=performance&grade=12");
    await expect(page.getByText("Select a program to view performance data.")).toBeVisible();

    await page.goForward();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12");
    await expect(page.getByText("E2E Full Test")).toBeVisible();
  });
});
