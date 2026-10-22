import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("login page renders correctly", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Avanti Fellows")).toBeVisible();
    await expect(
      page.getByText("Student Enrollment Management")
    ).toBeVisible();
    await expect(page.getByText("Sign in with Google")).toBeVisible();
    await expect(page.getByText("Enter School Passcode")).toHaveCount(0);
  });

  test("unauthenticated user accessing /dashboard redirects to login", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // The proxy sends them to sign-in, remembering where they were going.
    await page.waitForURL("/?callbackUrl=%2Fdashboard");
    await expect(page.getByText("Avanti Fellows")).toBeVisible();
  });

  test("unauthenticated user accessing /admin redirects to login", async ({
    page,
  }) => {
    await page.goto("/admin");

    await page.waitForURL("/");
    await expect(page.getByText("Avanti Fellows")).toBeVisible();
  });
});
