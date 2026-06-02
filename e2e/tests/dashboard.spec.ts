import { test, expect } from "../fixtures/auth";

test.describe("Dashboard — Admin", () => {
  test("admin sees schools dashboard and Admin link", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");

    await expect(adminPage.getByRole("heading", { name: "My Schools" })).toBeVisible();
    await expect(adminPage.getByText("Admin access")).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Admin" })).toBeVisible();
    await expect(adminPage.getByText("Sign out")).toBeVisible();
  });
});

test.describe("Dashboard — PM", () => {
  test("PM sees dashboard stats and no Admin link", async ({ pmPage }) => {
    await pmPage.goto("/dashboard?q=E2E");

    await expect(pmPage.getByRole("heading", { name: "My Schools" })).toBeVisible();
    // PM should see stats cards
    await expect(pmPage.getByText("My Schools").first()).toBeVisible();
    // PM should NOT see Admin link
    await expect(pmPage.getByRole("link", { name: "Admin" })).not.toBeVisible();
    // Summary navigation is admin/program-admin only.
    await expect(pmPage.getByRole("link", { name: "Schools" })).toBeVisible();
    await expect(pmPage.getByRole("link", { name: "Visit Summary" })).toHaveCount(0);
  });
});

test.describe("Dashboard — Passcode user", () => {
  test("passcode user is redirected to their school page", async ({
    passcodePage,
  }) => {
    await passcodePage.goto("/dashboard");

    // Passcode users should be redirected to /school/{schoolCode}
    await passcodePage.waitForURL(/\/school\//);
  });
});
