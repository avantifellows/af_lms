import { test, expect } from "../fixtures/auth";
import type { Page } from "@playwright/test";

// The roster page header's Back arrow (icon-only link).
const backLink = (page: Page) => page.locator('header a[href^="/dashboard"]');

test.describe("Dashboard — Admin", () => {
  test("admin lands on Physical Centres with the Admin link", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");

    await expect(adminPage.getByRole("heading", { name: "Physical Centres", exact: true, level: 2 })).toBeVisible();
    await expect(adminPage.getByText("Admin access")).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Admin" })).toBeVisible();
    await expect(adminPage.getByText("Sign out")).toBeVisible();
  });

  test("admin sees JNV NVS Schools when that view is chosen", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");
    await adminPage.getByRole("link", { name: "JNV NVS Schools" }).click();

    await adminPage.waitForURL("/dashboard?view=jnv-nvs");
    await expect(adminPage.getByRole("heading", { name: "JNV NVS Schools", exact: true, level: 2 })).toBeVisible();
  });

  test("a Centre opened from the landing returns to Physical Centres", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");
    await adminPage.locator('a[href^="/centre/"]').first().click();
    await adminPage.waitForURL(/\/centre\/\d+/);

    await expect(backLink(adminPage)).toHaveAttribute("href", "/dashboard?view=centres");
    await backLink(adminPage).click();

    await adminPage.waitForURL("/dashboard?view=centres");
    await expect(adminPage.getByRole("heading", { name: "Physical Centres", exact: true, level: 2 })).toBeVisible();
  });

  test("a School opened from JNV NVS Schools returns to JNV NVS Schools", async ({ adminPage }) => {
    await adminPage.goto("/dashboard?view=jnv-nvs");
    await adminPage.locator('a[href^="/school/"]').first().click();
    await adminPage.waitForURL(/\/school\//);

    await expect(backLink(adminPage)).toHaveAttribute("href", "/dashboard?view=jnv-nvs");
    await backLink(adminPage).click();

    await adminPage.waitForURL("/dashboard?view=jnv-nvs");
    await expect(adminPage.getByRole("heading", { name: "JNV NVS Schools", exact: true, level: 2 })).toBeVisible();
  });

  test("JNV NVS Schools pagination stays on JNV NVS Schools", async ({ adminPage }) => {
    await adminPage.goto("/dashboard?view=jnv-nvs");
    await adminPage.getByRole("link", { name: "2", exact: true }).click();

    await adminPage.waitForURL("/dashboard?view=jnv-nvs&page=2");
    await expect(adminPage.getByRole("heading", { name: "JNV NVS Schools", exact: true, level: 2 })).toBeVisible();
  });

  test("JNV NVS Schools pagination keeps the search", async ({ adminPage }) => {
    await adminPage.goto("/dashboard?view=jnv-nvs&q=JNV");
    await adminPage.getByRole("link", { name: "2", exact: true }).click();

    await adminPage.waitForURL("/dashboard?q=JNV&view=jnv-nvs&page=2");
    await expect(adminPage.getByRole("heading", { name: "JNV NVS Schools", exact: true, level: 2 })).toBeVisible();
  });

  // #391: cards only open their destination; the Visit entry point lives there.
  test("admin opens a School card and starts a Visit from the School page", async ({ adminPage }) => {
    await adminPage.goto("/dashboard?view=jnv-nvs");
    await expect(adminPage.getByRole("link", { name: "Start Visit" })).toHaveCount(0);

    await adminPage.locator('a[href^="/school/"]').first().click();
    await adminPage.waitForURL(/\/school\/[^/]+$/);

    await expect(adminPage.getByRole("link", { name: "Start Visit" })).toHaveAttribute("href", /\/school\/[^/]+\/visit\/new$/);
  });

  test("admin opens a Centre card and starts a Visit from the Centre page", async ({ adminPage }) => {
    await adminPage.goto("/dashboard?view=centres");
    await expect(adminPage.getByRole("link", { name: "Start Visit" })).toHaveCount(0);

    await adminPage.locator('a[href^="/centre/"]').first().click();
    await adminPage.waitForURL(/\/centre\/\d+/);

    await expect(adminPage.getByRole("link", { name: "Start Visit" })).toHaveAttribute("href", /\/school\/[^/]+\/visit\/new$/);
  });
});

test.describe("Dashboard — PM", () => {
  test("PM lands on Physical Centres with stats and no Admin link", async ({ pmPage }) => {
    await pmPage.goto("/dashboard");

    await expect(pmPage.getByRole("heading", { name: "Physical Centres", exact: true, level: 2 })).toBeVisible();
    await expect(pmPage.getByText("My Schools").first()).toBeVisible();
    await expect(pmPage.getByText("Total Visits")).toBeVisible();
    await expect(pmPage.getByRole("link", { name: "Admin" })).not.toBeVisible();
    await expect(pmPage.getByRole("link", { name: "Curriculum Summary" })).toBeVisible();
  });
});

test.describe("Dashboard — NVS-only teacher", () => {
  test("an NVS-only teacher lands on JNV NVS Schools", async ({ teacherPage }) => {
    await teacherPage.goto("/dashboard");

    await expect(teacherPage.getByText("Search Students")).toBeVisible();
    await expect(teacherPage.getByPlaceholder("Search centres by name, school, or code...")).toHaveCount(0);
  });
});
