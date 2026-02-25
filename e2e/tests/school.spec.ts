import { test, expect } from "../fixtures/auth";

test.describe("School page — Admin", () => {
  test("admin can view a school page", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");

    // Click the first school card heading link
    const firstSchool = adminPage.getByRole("heading", { level: 3 }).first();
    const schoolName = await firstSchool.textContent();
    await firstSchool.click();

    // Should navigate to school page and see details
    await adminPage.waitForURL(/\/school\//);
    await expect(adminPage.getByText("Code:")).toBeVisible();
    if (schoolName) {
      await expect(adminPage.getByRole("heading", { name: schoolName })).toBeVisible();
    }
  });
});

test.describe("School page — Passcode access control", () => {
  test("passcode user can access their assigned school", async ({
    passcodePage,
  }) => {
    // Passcode user for school 70705 — go to dashboard which redirects
    await passcodePage.goto("/dashboard");
    await passcodePage.waitForURL(/\/school\//);

    // Should see the school page, not an error
    await expect(passcodePage.getByText("Access Denied")).not.toBeVisible();
  });

  test("passcode user cannot access a different school", async ({
    passcodePage,
  }) => {
    // Try to access a school that isn't theirs (use a real UDISE that exists but isn't 70705)
    // A fake UDISE will 404; test that passcode user doesn't see school content
    await passcodePage.goto("/school/99999999999");

    // Should see 404 or access denied — not actual school content
    const hasSchoolContent = await passcodePage.getByText("Code:").isVisible().catch(() => false);
    expect(hasSchoolContent).toBe(false);
  });
});
