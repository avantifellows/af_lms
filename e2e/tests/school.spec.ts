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
