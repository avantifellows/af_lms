import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";
import {
  TEST_ATTENDANCE_PMU,
  TEST_ATTENDANCE_SCHOOL_CODE,
  removeTestAttendanceFixture,
  seedTestAttendanceFixture,
} from "../helpers/test-attendance-fixtures";

// Test Attendance tab (#517): NVS Schools only. A PMU Govt School User at a
// JNV School with listed NVS Students sees the tab right after Performance;
// the e2e teacher opens the same School page without it.
test.describe("Test Attendance tab", () => {
  const pool = getTestPool();

  test.beforeAll(async () => {
    await seedTestAttendanceFixture(pool);
  });

  test.afterAll(async () => {
    await removeTestAttendanceFixture(pool);
    await pool.end();
  });

  test("a PMU Govt School User sees it on their School and a teacher does not", async ({ page, teacherPage }) => {
    await signInAs(page, TEST_ATTENDANCE_PMU);
    await page.goto("/dashboard");
    await page.waitForURL(`**/school/${TEST_ATTENDANCE_SCHOOL_CODE}`);

    const tabs = page.getByRole("tablist", { name: "School sections" });
    const tabNames = await tabs.getByRole("tab").allTextContents();
    expect(tabNames).toEqual(["Enrollment", "Performance", "Test Attendance"]);

    await tabs.getByRole("tab", { name: "Test Attendance" }).click();
    const enrolled = page.getByRole("region", { name: "Enrolled" });
    await expect(enrolled).toContainText("2");
    await expect(page.getByText("No Monthly Tests yet")).toBeVisible();

    await teacherPage.goto(`/school/${TEST_ATTENDANCE_SCHOOL_CODE}`);
    const teacherTabs = teacherPage.getByRole("tablist", { name: "School sections" });
    await expect(teacherTabs.getByRole("tab", { name: "Performance" })).toBeVisible();
    await expect(teacherTabs.getByRole("tab", { name: "Test Attendance" })).toHaveCount(0);
  });
});
