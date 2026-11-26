import ExcelJS from "exceljs";
import type { Locator, Page } from "@playwright/test";

import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";
import { TEST_ATTENDANCE_GRADES } from "../../src/types/test-attendance";
import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";
import {
  TEST_ATTENDANCE_PMU,
  TEST_ATTENDANCE_RESPONSE,
  TEST_ATTENDANCE_SCHOOL_CODE,
  removeTestAttendanceFixture,
  seedTestAttendanceFixture,
} from "../helpers/test-attendance-fixtures";

/** Opens the tab with the read route answered in the browser by the stub response. */
async function openLoadedTab(page: Page) {
  await page.route("**/api/school/*/test-attendance", (route) => route.fulfill({ json: TEST_ATTENDANCE_RESPONSE }));
  await signInAs(page, TEST_ATTENDANCE_PMU);
  await page.goto(`/school/${TEST_ATTENDANCE_SCHOOL_CODE}`);
  await page.getByRole("tablist", { name: "School sections" }).getByRole("tab", { name: "Test Attendance" }).click();
  await expect(page.getByRole("group", { name: "Period" })).toBeVisible();
}

/** Clicks Download and reads the saved file's only sheet back: its name and its rows as text. */
async function downloadSheet(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await download.path());
  expect(workbook.worksheets).toHaveLength(1);
  const sheet = workbook.worksheets[0];
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    rows.push(Array.from({ length: sheet.columnCount }, (_, i) => String(row.getCell(i + 1).value ?? "")));
  });
  return { filename: download.suggestedFilename(), name: sheet.name, header: rows[0], rows: rows.slice(1) };
}

/** A visible table's body rows: each cell's text, and each month box as its status ("" when not counted). */
async function screenRows(table: Locator) {
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll("td")).flatMap((cell) => {
        const boxes = Array.from(cell.querySelectorAll('[role="img"]'));
        if (boxes.length === 0) return [cell.textContent ?? ""];
        return boxes.map((box) => {
          const status = (box.getAttribute("aria-label") ?? "").split(": ")[1];
          return status === "not counted" ? "" : status;
        });
      }),
    ),
  );
}

// Test Attendance tab (#517): NVS Schools only. A PMU Govt School User at a
// JNV School with listed NVS Students sees the tab right after Performance;
// the e2e teacher opens the same School page without it. Monthly Tests come
// from the local e2e Postgres `session` table (ADR 0014); the e2e database has
// no matching NVS mandated sessions, so `getNvsTestSets()` returns [], the
// attendance read skips BigQuery (and `lastRefreshed` tolerates the blank
// GOOGLE_SERVICE_ACCOUNT_JSON as null), and the tab shows its Enrolled count
// with "No Monthly Tests yet".
test.describe("Test Attendance tab", () => {
  const pool = getTestPool();

  test.beforeAll(async () => {
    const [startYear, endYear] = CURRENT_ACADEMIC_YEAR.split("-");
    const { rows } = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM session
        WHERE meta_data->>'test_purpose' = $1
          AND meta_data->>'group' = $2
          AND meta_data->>'grade' = ANY($3::text[])
          AND is_active = true
          AND start_time >= $4::timestamp
          AND start_time < $5::timestamp
          AND COALESCE(btrim(platform_id), '') <> ''`,
      ["system_wide_mandated", "EnableStudents", TEST_ATTENDANCE_GRADES.map(String), `${startYear}-04-01 00:00:00`, `${endYear}-04-01 00:00:00`],
    );
    expect(
      rows[0]?.count ?? 0,
      "e2e database must have no active current-year NVS mandated sessions so the tab skips BigQuery and shows 'No Monthly Tests yet'",
    ).toBe(0);
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
    await expect(enrolled).toBeVisible();
    await expect(enrolled.getByText("2", { exact: true })).toBeVisible();
    await expect(page.getByText("No Monthly Tests yet")).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't load Test Attendance" })).toHaveCount(0);

    await teacherPage.goto(`/school/${TEST_ATTENDANCE_SCHOOL_CODE}`);
    const teacherTabs = teacherPage.getByRole("tablist", { name: "School sections" });
    await expect(teacherTabs.getByRole("tab", { name: "Performance" })).toBeVisible();
    await expect(teacherTabs.getByRole("tab", { name: "Test Attendance" })).toHaveCount(0);
  });

  // Download builds the file in the browser from the response on screen, so
  // the file holds exactly the rows the user sees, in the same order.
  test("Download saves a month's list exactly as it is on screen", async ({ page }) => {
    await openLoadedTab(page);
    await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "October" }).click();
    await page.getByRole("group", { name: "Show Students" }).getByRole("button", { name: "All" }).click();

    const table = page.getByRole("table", { name: "Students" });
    const onScreen = await screenRows(table);
    expect(onScreen.length).toBeGreaterThan(1);
    const file = await downloadSheet(page);

    expect(file.filename).toBe(`test-attendance-${TEST_ATTENDANCE_SCHOOL_CODE}-october.xlsx`);
    expect(file.name).toBe("October");
    expect(file.header).toEqual(["Student Name", "Student ID", "APAAR ID", "Grade", "Exam Preparing For", "Status", "Previous 3 tests"]);
    // Same Students, same order, same values (blank cells in Excel show as "—" on screen).
    expect(file.rows.map(([name, studentId, apaarId, ...rest]) => [name, studentId || "—", apaarId || "—", ...rest])).toEqual(onScreen);
    expect(file.rows.map((row) => [row[1], row[2]])).toEqual(
      onScreen.map(([name]) => {
        const student = TEST_ATTENDANCE_RESPONSE.students.find((s) => s.name === name);
        return [student?.studentId ?? "", student?.apaarId ?? ""];
      }),
    );

    // A narrower list downloads narrower: Grade 12, Absent.
    await page.getByRole("group", { name: "Grade" }).getByRole("button", { name: "12" }).click();
    await page.getByRole("group", { name: "Show Students" }).getByRole("button", { name: "Absent" }).click();
    const absent = await screenRows(table);
    const absentFile = await downloadSheet(page);
    expect(absentFile.rows.map(([name, studentId, apaarId, ...rest]) => [name, studentId || "—", apaarId || "—", ...rest])).toEqual(absent);
    expect(absent.map(([name]) => name)).toEqual(["Ravi Sen"]);
  });

  test("Download saves the All year list exactly as it is on screen", async ({ page }) => {
    await openLoadedTab(page);
    await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "All year" }).click();

    const table = page.getByRole("table", { name: "All students" });
    const headers = await table.getByRole("columnheader").allTextContents();
    for (const list of ["All students", "Need follow-up", "Not submitting"]) {
      await page.getByRole("group", { name: "Show Students" }).getByRole("button", { name: list }).click();
      const onScreen = await screenRows(table);
      const file = await downloadSheet(page);

      expect(file.filename).toBe(`test-attendance-${TEST_ATTENDANCE_SCHOOL_CODE}-all-year.xlsx`);
      expect(file.name).toBe("All year");
      expect(file.header.slice(0, 5)).toEqual(["Student Name", "Student ID", "APAAR ID", "Grade", "Exam Preparing For"]);
      expect(file.header.slice(5, -3)).toEqual(headers.slice(5, -2));
      // Screen: name, Student ID, APAAR ID, grade, Exam Preparing For, a status per month, Attended, tag + note in one cell.
      const fileAsScreen = file.rows.map(([name, studentId, apaarId, ...rest]) => {
        const [tag, note] = rest.slice(-2);
        return [name, studentId || "—", apaarId || "—", ...rest.slice(0, -2), tag + note];
      });
      expect(fileAsScreen).toEqual(onScreen);
    }
    // The tagged Students are on screen and in the file.
    await page.getByRole("group", { name: "Show Students" }).getByRole("button", { name: "Need follow-up" }).click();
    expect((await screenRows(table)).map(([name]) => name)).toEqual(["Asha Bose", "Kiran Das"]);
  });

  test("Download says so when the file cannot be made", async ({ page }) => {
    await openLoadedTab(page);
    await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "October" }).click();
    // ExcelJS arrives in its own chunk on the first Download; make that load fail.
    await page.route("**/_next/static/chunks/**", (route) => route.abort());

    await page.getByRole("button", { name: "Download" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Couldn't download this list. Please try again." })).toBeVisible();
  });
});
