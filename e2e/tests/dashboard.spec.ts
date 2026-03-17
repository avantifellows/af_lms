import { test, expect } from "../fixtures/auth";

test.describe("Dashboard — Admin", () => {
  test("admin sees Schools heading and Admin link", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");

    await expect(adminPage.getByRole("heading", { name: "Schools", exact: true, level: 1 })).toBeVisible();
    await expect(adminPage.getByText("Admin access")).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Admin" })).toBeVisible();
    await expect(adminPage.getByText("Sign out")).toBeVisible();
  });
});

test.describe("Dashboard — PM", () => {
  test("PM sees dashboard stats and no Admin link", async ({ pmPage }) => {
    await pmPage.goto("/dashboard");

    await expect(pmPage.getByRole("heading", { name: "Schools", exact: true, level: 1 })).toBeVisible();
    // PM should see stats cards
    await expect(pmPage.getByText("My Schools").first()).toBeVisible();
    // PM should NOT see Admin link
    await expect(pmPage.getByRole("link", { name: "Admin" })).not.toBeVisible();
    // PM should see Visits nav
    await expect(pmPage.getByRole("link", { name: "Visits" })).toBeVisible();
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
