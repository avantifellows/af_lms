import { test, expect } from "../fixtures/auth";
import { getTestPool, seedTestVisit } from "../helpers/db";
import type { Pool } from "pg";

let pool: Pool;
let schoolCode: string;
let visitId: number;

test.beforeAll(async () => {
  pool = getTestPool();

  // Ensure an AHMEDABAD school exists (PM test user's region)
  const { rows } = await pool.query(
    `SELECT code FROM school WHERE region = 'AHMEDABAD' LIMIT 1`
  );
  if (rows.length > 0) {
    schoolCode = rows[0].code;
  } else {
    // Seed a test school in the PM's region
    schoolCode = "E2EAHM001";
    await pool.query(
      `INSERT INTO school (code, name, region, inserted_at, updated_at)
       VALUES ($1, 'E2E Test School Ahmedabad', 'AHMEDABAD', NOW(), NOW())`,
      [schoolCode]
    );
  }
});

test.afterAll(async () => {
  if (pool) await pool.end();
});

/* ─── Group 1: Visits list page (no visits seeded yet) ───────────── */

test.describe("Visits — List page", () => {
  test("PM sees All Visits heading and empty state", async ({ pmPage }) => {
    await pmPage.goto("/visits");

    await expect(
      pmPage.getByRole("heading", { name: "All Visits" })
    ).toBeVisible();
    await expect(pmPage.getByText("No visits recorded yet.")).toBeVisible();
  });

  test("teacher is redirected away from /visits", async ({ teacherPage }) => {
    await teacherPage.goto("/visits");

    await expect(
      teacherPage.getByRole("heading", { name: "All Visits" })
    ).not.toBeVisible();
  });
});

/* ─── Group 2: Create visit flow ─────────────────────────────────── */

test.describe("Visits — Create flow", () => {
  test("PM sees new visit form with school code", async ({ pmPage }) => {
    await pmPage.context().grantPermissions(["geolocation"]);
    await pmPage.context().setGeolocation({
      latitude: 23.0225,
      longitude: 72.5714,
      accuracy: 50,
    });

    await pmPage.goto(`/school/${schoolCode}/visit/new`);

    await expect(
      pmPage.getByRole("heading", { name: "Start New School Visit" })
    ).toBeVisible();
    await expect(pmPage.locator(`input[value="${schoolCode}"]`)).toBeVisible();
  });

  test("PM creates visit with GPS and is redirected to detail", async ({
    pmPage,
  }) => {
    await pmPage.context().grantPermissions(["geolocation"]);
    await pmPage.context().setGeolocation({
      latitude: 23.0225,
      longitude: 72.5714,
      accuracy: 50,
    });

    await pmPage.goto(`/school/${schoolCode}/visit/new`);

    // Wait for GPS to be acquired
    await expect(pmPage.getByText("Location acquired")).toBeVisible({
      timeout: 10_000,
    });

    // Submit the form
    await pmPage.getByRole("button", { name: "Start Visit" }).click();

    // Should redirect to visit detail page
    await pmPage.waitForURL(/\/visits\/\d+/, { timeout: 15_000 });
    await expect(pmPage.getByText("In Progress")).toBeVisible();
  });
});

/* ─── Group 3: Visit detail page (seeded visit) ──────────────────── */

test.describe("Visits — Detail page", () => {
  test.beforeAll(async () => {
    const result = await seedTestVisit(pool, schoolCode);
    visitId = result.visitId;
  });

  test("PM sees visit in In Progress table on list page", async ({
    pmPage,
  }) => {
    await pmPage.goto("/visits");

    await expect(
      pmPage.getByRole("heading", { name: "In Progress" })
    ).toBeVisible();
    await expect(
      pmPage.getByRole("link", { name: "Continue" }).first()
    ).toBeVisible();
  });

  test("PM sees visit detail with status and progress", async ({ pmPage }) => {
    await pmPage.goto(`/visits/${visitId}`);

    await expect(pmPage.getByText("In Progress")).toBeVisible();
    await expect(pmPage.getByText("0 of 6 sections")).toBeVisible();
  });

  test("all 6 section links are rendered", async ({ pmPage }) => {
    await pmPage.goto(`/visits/${visitId}`);

    for (const name of [
      "Principal Meeting",
      "Leadership Meetings",
      "Classroom Observations",
      "Student Discussions",
      "Staff Meetings",
      "Feedback & Issues",
    ]) {
      await expect(pmPage.getByText(name).first()).toBeVisible();
    }
  });

  test("End Visit button is visible", async ({ pmPage }) => {
    await pmPage.goto(`/visits/${visitId}`);

    await expect(
      pmPage.getByRole("button", { name: "End Visit" })
    ).toBeVisible();
  });
});

/* ─── Group 4: Principal meeting form ─────────────────────────────── */

test.describe("Visits — Principal meeting", () => {
  test("PM fills and saves principal meeting form", async ({ pmPage }) => {
    await pmPage.goto(`/visits/${visitId}/principal`);

    // Wait for loading to complete
    await expect(
      pmPage.getByRole("heading", { name: "Principal Meeting" })
    ).toBeVisible();

    // Initially shows "All changes saved"
    await expect(pmPage.getByText("All changes saved")).toBeVisible();

    // Fill in Syllabus Status textarea
    await pmPage
      .getByPlaceholder(/Physics G11/)
      .fill("All subjects on track for completion by March");

    // Should show unsaved changes
    await expect(pmPage.getByText("Unsaved changes")).toBeVisible();

    // Click the Save button (not "Save & Return to Overview")
    await pmPage.getByRole("button", { name: "Save", exact: true }).click();

    // Wait for save to complete
    await expect(pmPage.getByText("All changes saved")).toBeVisible({
      timeout: 5_000,
    });
  });
});

/* ─── Group 5: Access control ─────────────────────────────────────── */

test.describe("Visits — Access control", () => {
  test("teacher cannot access /visits", async ({ teacherPage }) => {
    await teacherPage.goto("/visits");

    // Teacher should be redirected to /dashboard
    await teacherPage.waitForURL(/\/dashboard/);
  });

  test("teacher cannot access new visit page", async ({ teacherPage }) => {
    await teacherPage.goto(`/school/${schoolCode}/visit/new`);

    // Should be redirected (no visit edit permission)
    await expect(
      teacherPage.getByRole("heading", { name: "Start New School Visit" })
    ).not.toBeVisible();
  });

  test("admin can view PM-created visit", async ({ adminPage }) => {
    await adminPage.goto(`/visits/${visitId}`);

    await expect(adminPage.getByText("In Progress")).toBeVisible();
    await expect(adminPage.getByText(/\d+ of 6 sections/)).toBeVisible();
  });
});
