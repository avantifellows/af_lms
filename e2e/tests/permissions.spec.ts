import { test, expect } from "../fixtures/auth";

test.describe("Permission matrix — /admin", () => {
  test("admin can access /admin", async ({ adminPage }) => {
    await adminPage.goto("/admin");

    await expect(adminPage.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(adminPage.getByText("Manage users and permissions")).toBeVisible();
  });

  test("PM cannot access /admin", async ({ pmPage }) => {
    await pmPage.goto("/admin");

    // Should be redirected or see access denied
    await expect(pmPage.getByRole("heading", { name: "Admin" })).not.toBeVisible();
  });

  test("teacher cannot access /admin", async ({ teacherPage }) => {
    await teacherPage.goto("/admin");

    await expect(teacherPage.getByRole("heading", { name: "Admin" })).not.toBeVisible();
  });
});

test.describe("Permission matrix — /visits", () => {
  test("PM can access /visits", async ({ pmPage }) => {
    await pmPage.goto("/visits");

    await expect(pmPage.getByRole("heading", { name: "All Visits" })).toBeVisible();
  });

  test("teacher cannot access /visits", async ({ teacherPage }) => {
    await teacherPage.goto("/visits");

    // Teacher should not see the visits page content
    await expect(teacherPage.getByRole("heading", { name: "All Visits" })).not.toBeVisible();
  });
});

test.describe("Permission matrix — /dashboard", () => {
  test("admin sees Admin link in header", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");

    await expect(adminPage.getByRole("link", { name: "Admin" })).toBeVisible();
  });

  test("PM does not see Admin link", async ({ pmPage }) => {
    await pmPage.goto("/dashboard");

    await expect(pmPage.getByRole("link", { name: "Admin" })).not.toBeVisible();
  });

  test("teacher does not see Admin link", async ({ teacherPage }) => {
    await teacherPage.goto("/dashboard");

    await expect(teacherPage.getByRole("link", { name: "Admin" })).not.toBeVisible();
  });
});
