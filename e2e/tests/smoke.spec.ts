import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("login page renders correctly", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Avanti Fellows")).toBeVisible();
    await expect(
      page.getByText("Student Enrollment Management")
    ).toBeVisible();
    await expect(page.getByText("Sign in with Google")).toBeVisible();
    await expect(page.getByText("Enter School Passcode")).toBeVisible();
  });

  test("unauthenticated user accessing /dashboard redirects to login", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // NextAuth should redirect to the sign-in page
    await page.waitForURL("/");
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
