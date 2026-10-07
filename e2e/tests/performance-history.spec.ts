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

function deepDive(sessionId: string | null) {
  const test = OVERVIEW.tests.find((t) => t.session_id === sessionId);
  return {
    summary: {
      test_name: test?.test_name ?? "Unknown",
      start_date: test?.start_date ?? "2026-07-01",
      students_appeared: 8,
      students_submitted: 8,
      avg_score: 50,
      min_score: 20,
      max_score: 80,
      avg_marks: 50,
      min_marks: 20,
      max_marks: 80,
      total_marks: 100,
      avg_accuracy: 60,
      avg_attempt_rate: 70,
    },
    subjects: [],
    chapters: [],
    students: [],
  };
}

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
    if (url.pathname.endsWith("/test-deep-dive")) {
      await route.fulfill({ json: deepDive(url.searchParams.get("sessionId")) });
      return;
    }
    if (url.pathname.endsWith("/combined-reports")) {
      await route.fulfill({ json: { jobs: [], can_generate: false } });
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

function reportTitle(page: Page, name: string) {
  return page.getByRole("heading", { level: 2, name, exact: true });
}

function backToOverview(page: Page) {
  return page.getByRole("button", { name: "Back to overview" });
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

  test("Centre: a report is a step of its own, and Back to overview consumes it", async ({ adminPage: page }) => {
    await stubAnalytics(page, (program) => [program ?? "JNV CoE"]);

    await page.goto("/dashboard?view=centres");
    await page.locator('a[href^="/centre/"]').first().click();
    await page.waitForURL(/\/centre\/\d+$/);
    const centrePath = new URL(page.url()).pathname;

    await page.goto(`${centrePath}?tab=performance`);
    await expectQuery(page, "tab=performance&grade=12");
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await button(page, "Grade", "11").click();
    await expectQuery(page, "tab=performance&grade=11");
    await button(page, "Test type", "Chapter tests").click();
    await expectQuery(page, "tab=performance&grade=11&category=chapter");
    await page.getByText("E2E Chapter Test", { exact: true }).click();
    await expectQuery(page, "tab=performance&grade=11&category=chapter&session=e2e-chapter");
    await expect(reportTitle(page, "E2E Chapter Test")).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    // Back closes the report onto its filtered overview, then undoes the category.
    await page.goBack();
    await expectQuery(page, "tab=performance&grade=11&category=chapter");
    await expect(button(page, "Test type", "Chapter tests")).toHaveAttribute("aria-pressed", "true");
    await expect(backToOverview(page)).toHaveCount(0);
    await page.goBack();
    await expectQuery(page, "tab=performance&grade=11");
    await expect(button(page, "Test type", "Full tests")).toHaveAttribute("aria-pressed", "true");

    await page.goForward();
    await expectQuery(page, "tab=performance&grade=11&category=chapter");
    await page.goForward();
    await expectQuery(page, "tab=performance&grade=11&category=chapter&session=e2e-chapter");
    await expect(reportTitle(page, "E2E Chapter Test")).toBeVisible();

    // The report's provenance survived Back/Forward: the in-page Back consumes
    // the report step, so one more Back undoes the category — no duplicate overview.
    await backToOverview(page).click();
    await expectQuery(page, "tab=performance&grade=11&category=chapter");
    await expect(button(page, "Test type", "Chapter tests")).toHaveAttribute("aria-pressed", "true");
    await page.goBack();
    await expectQuery(page, "tab=performance&grade=11");
    expect(new URL(page.url()).pathname).toBe(centrePath);
  });

  test("multi-Program School: report provenance through Grade change, tab switch and direct link", async ({ adminPage: page }) => {
    await stubAnalytics(page, () => ["JNV CoE", "JNV Nodal"]);

    await page.goto("/dashboard?view=jnv-nvs");
    await page.locator('a[href^="/school/"]').first().click();
    await page.waitForURL(/\/school\/[^/?]+$/);
    const schoolPath = new URL(page.url()).pathname;

    await page.goto(`${schoolPath}?tab=performance&program=JNV+CoE&grade=12`);
    await page.getByText("E2E Full Test", { exact: true }).click();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12&session=e2e-full");
    await expect(reportTitle(page, "E2E Full Test")).toBeVisible();

    // Overview → report → Grade change → Back to the report → in-page Back.
    await button(page, "Grade", "11").click();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=11");
    await page.goBack();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12&session=e2e-full");
    await expect(reportTitle(page, "E2E Full Test")).toBeVisible();
    await backToOverview(page).click();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12");
    await expect(page.getByRole("button", { name: "JNV CoE", exact: true })).toBeVisible();

    // Reopen, switch School sections (replace), and come back by history.
    await page.getByText("E2E Full Test", { exact: true }).click();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12&session=e2e-full");
    await page.getByRole("tab", { name: "Enrollment" }).click();
    await expectQuery(page, "program=JNV+CoE&grade=12&session=e2e-full");
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expectQuery(page, "tab=performance&program=JNV+CoE&grade=12");
    await expect(page.getByRole("tab", { name: "Performance" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("E2E Full Test", { exact: true })).toBeVisible();
    await page.goForward();
    await expectQuery(page, "program=JNV+CoE&grade=12&session=e2e-full");
    await expect(page.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");

    // The remounted report has unknown provenance: in-page Back drops only the report.
    await page.getByRole("tab", { name: "Performance" }).click();
    await expectQuery(page, "program=JNV+CoE&grade=12&session=e2e-full&tab=performance");
    await expect(reportTitle(page, "E2E Full Test")).toBeVisible();
    await backToOverview(page).click();
    await expectQuery(page, "program=JNV+CoE&grade=12&tab=performance");
    expect(new URL(page.url()).pathname).toBe(schoolPath);
    await expect(page.getByText("E2E Full Test", { exact: true })).toBeVisible();

    // A direct link to a report: in-page Back stays in the LMS, filters intact.
    await page.goto(`${schoolPath}?tab=performance&program=JNV+Nodal&grade=11&stream=pcm&session=e2e-chapter`);
    await expect(reportTitle(page, "E2E Chapter Test")).toBeVisible();
    await backToOverview(page).click();
    await expectQuery(page, "tab=performance&program=JNV+Nodal&grade=11&stream=pcm");
    expect(new URL(page.url()).pathname).toBe(schoolPath);
    await expect(button(page, "Stream", "PCM")).toHaveAttribute("aria-pressed", "true");
  });
});
