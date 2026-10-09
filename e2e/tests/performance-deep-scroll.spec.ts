import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth";

const LONG_REPORT = {
  summary: {
    test_name: "E2E Long Report",
    start_date: "2026-07-01",
    students_appeared: 90,
    students_submitted: 90,
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
  students: Array.from({ length: 90 }, (_, index) => ({
    student_name: `E2E Student ${index + 1}`,
    enrollment_user_id: String(index + 1),
    gender: null,
    category: null,
    academic_level: null,
    qualification_status: null,
    marks_scored: 50,
    max_marks: 100,
    percentage: 50,
    accuracy: 60,
    attempt_rate: 70,
    subject_scores: [],
    has_quiz_ended: true,
  })),
};

async function stubAnalytics(page: Page) {
  await page.route("**/api/quiz-analytics/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/grades")) {
      await route.fulfill({
        json: { grades: [12], programs: [url.searchParams.get("program") ?? "JNV CoE"] },
      });
      return;
    }
    if (url.pathname.endsWith("/batch-overview")) {
      await route.fulfill({
        json: {
          summary: { tests_conducted: 1, avg_participation: 90 },
          tests: [{
            session_id: "e2e-long",
            test_name: "E2E Long Report",
            start_date: "2026-07-01",
            student_count: 90,
            stream_student_count: 90,
            test_format: "full_test",
            test_stream: null,
            test_grade: 12,
            subjects: [],
          }],
          totalEnrolled: 90,
          enrolledByStream: {},
          streams: [],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/test-deep-dive")) {
      await route.fulfill({ json: LONG_REPORT });
      return;
    }
    if (url.pathname.endsWith("/combined-reports")) {
      await route.fulfill({ json: { jobs: [], can_generate: false } });
      return;
    }
    await route.fulfill({ status: 404, json: {} });
  });
}

test("closing a reloaded, deeply-scrolled report brings its shorter overview into view", async ({
  adminPage: page,
}) => {
  await stubAnalytics(page);
  await page.setViewportSize({ width: 1280, height: 450 });

  await page.goto("/dashboard?view=centres");
  const centreHref = await page.locator('a[href^="/centre/"]').first().getAttribute("href");
  expect(centreHref).toBeTruthy();

  await page.goto(`${centreHref}?tab=performance&grade=12&session=e2e-long`);
  await expect(page.getByRole("heading", { level: 2, name: "E2E Long Report" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "E2E Long Report" })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 3_000));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(2_500);

  // A Playwright action click would scroll this top-of-report button into view
  // before dispatching the event and hide the regression. A DOM click leaves
  // the page at the deep position the handler must recover from.
  const scrollAtHandler = await page.getByRole("button", { name: "Back to overview" })
    .evaluate((button: HTMLButtonElement) => {
      const y = window.scrollY;
      button.click();
      return y;
    });
  expect(scrollAtHandler).toBeGreaterThanOrEqual(2_500);
  await expect.poll(() => new URL(page.url()).searchParams.has("session")).toBe(false);
  const overviewTest = page.getByText("E2E Long Report", { exact: true });
  await expect(overviewTest).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(2_500);
  await expect.poll(() => overviewTest.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  })).toBe(true);
});
