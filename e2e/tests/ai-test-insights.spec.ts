import type { Page } from "@playwright/test";

import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";
import {
  AI_TEST_INSIGHTS_COE_CENTRE_LIST,
  AI_TEST_INSIGHTS_NO_CENTRE_SCHOOL,
  AI_TEST_INSIGHTS_NODAL_CENTRE_LIST,
  AI_TEST_INSIGHTS_PERSONAS,
  AI_TEST_INSIGHTS_SCHOOL,
  AI_TEST_INSIGHTS_SCHOOL_LIST,
  removeAiTestInsightsFixture,
  seedAiTestInsightsFixture,
  type AiTestInsightsFixtureIds,
} from "../helpers/ai-test-insights-fixtures";

const TAB = "AI Test Insights";

function tabBar(page: Page) {
  return page.getByRole("tablist", { name: "School sections" });
}

/** The roster's tab names, once the page has rendered its tab bar. */
async function tabNames(page: Page): Promise<string[]> {
  await expect(tabBar(page).getByRole("tab", { name: "Enrollment" })).toBeVisible();
  return (await tabBar(page).getByRole("tab").allTextContents()).map((name) => name.trim());
}

/** Opens the tab and reads its rows as [name, Student ID, Grade]. */
async function listedRows(page: Page): Promise<string[][]> {
  await tabBar(page).getByRole("tab", { name: TAB }).click();
  return shownRows(page);
}

async function shownRows(page: Page): Promise<string[][]> {
  const table = page.getByRole("table", { name: "AI Test Insights students" });
  await expect(table).toBeVisible();
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const [student, grade] = Array.from(row.querySelectorAll("td"));
      const [name, code] = Array.from(student.querySelectorAll("div")).map((div) => div.textContent ?? "");
      return [name, code, grade.textContent ?? ""];
    }),
  );
}

function expectAfterTeacherFeedback(names: string[]) {
  // Teacher Feedback is not a Teacher's tab; Quiz Sessions comes before it.
  const before = names.includes("Teacher Feedback") ? "Teacher Feedback" : "Quiz Sessions";
  expect(names[names.indexOf(before) + 1]).toBe(TAB);
}

// AI Test Insights Tab (#550, slice #555): physical centres only. The helper
// seeds a JNV School with an active CoE and Nodal centre, its listed Students
// and one of each kind the tab leaves out, a second School, a School with no
// active centre, and the personas the e2e seed lacks.
test.describe("AI Test Insights tab", () => {
  const pool = getTestPool();
  let ids: AiTestInsightsFixtureIds;

  test.beforeAll(async () => {
    ids = await seedAiTestInsightsFixture(pool);
  });

  test.afterAll(async () => {
    await removeAiTestInsightsFixture(pool);
    await pool.end();
  });

  test("lists exactly the declared JEE Students on the School page and each Centre page", async ({ adminPage }) => {
    await adminPage.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}`);
    expect(await listedRows(adminPage)).toEqual(AI_TEST_INSIGHTS_SCHOOL_LIST);

    await adminPage.goto(`/centre/${ids.coeCentreId}`);
    expect(await listedRows(adminPage)).toEqual(AI_TEST_INSIGHTS_COE_CENTRE_LIST);

    await adminPage.goto(`/centre/${ids.nodalCentreId}?tab=ai_test_insights`);
    expect(await shownRows(adminPage)).toEqual(AI_TEST_INSIGHTS_NODAL_CENTRE_LIST);
  });

  test("opens straight onto the tab from ?tab=ai_test_insights on the School page", async ({ adminPage }) => {
    await adminPage.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}?tab=ai_test_insights`);

    await expect(tabBar(adminPage).getByRole("tab", { name: TAB })).toHaveAttribute("aria-selected", "true");
    expect(await shownRows(adminPage)).toEqual(AI_TEST_INSIGHTS_SCHOOL_LIST);
  });

  test("shows the tab after Teacher Feedback for Teacher, Program Manager, Program Admin and Admin", async ({
    page,
    adminPage,
    pmPage,
    programAdminPage,
  }) => {
    await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
    for (const viewer of [page, pmPage, programAdminPage, adminPage]) {
      await viewer.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}`);
      expectAfterTeacherFeedback(await tabNames(viewer));
      expect(await listedRows(viewer)).toEqual(AI_TEST_INSIGHTS_SCHOOL_LIST);

      await viewer.goto(`/centre/${ids.coeCentreId}`);
      expectAfterTeacherFeedback(await tabNames(viewer));
    }
  });

  test("hides the tab for both PMU roles and an NVS-only Teacher", async ({ page }) => {
    for (const persona of [
      AI_TEST_INSIGHTS_PERSONAS.pmuManager,
      AI_TEST_INSIGHTS_PERSONAS.pmuGovtSchoolUser,
      AI_TEST_INSIGHTS_PERSONAS.nvsOnlyTeacher,
    ]) {
      await signInAs(page, persona);
      await page.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}`);
      expect(await tabNames(page)).not.toContain(TAB);
    }
  });

  test("hides the tab for the Holistic Mentorship admin", async ({ holisticAdminPage }) => {
    await holisticAdminPage.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}`);
    await expect(holisticAdminPage.getByText(AI_TEST_INSIGHTS_SCHOOL.name).first()).toBeVisible();

    await expect(holisticAdminPage.getByRole("tab", { name: TAB })).toHaveCount(0);
  });

  test("hides the tab for every role at a School with no active centre", async ({
    page,
    adminPage,
    pmPage,
    programAdminPage,
  }) => {
    await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
    for (const viewer of [page, pmPage, programAdminPage, adminPage]) {
      await viewer.goto(`/school/${AI_TEST_INSIGHTS_NO_CENTRE_SCHOOL.code}`);
      expect(await tabNames(viewer)).not.toContain(TAB);
    }
  });

  test("refuses a Teacher of another School with 403 from the list route", async ({ page }) => {
    await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.otherSchoolTeacher);

    const response = await page.request.get(`/api/school/${AI_TEST_INSIGHTS_SCHOOL.code}/ai-test-insights`);

    expect(response.status()).toBe(403);
  });

  test("keeps a seat-confined Teacher to their own centre", async ({ page }) => {
    await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.seatedTeacher);

    await page.goto(`/centre/${ids.coeCentreId}`);
    expect(await listedRows(page)).toEqual(AI_TEST_INSIGHTS_COE_CENTRE_LIST);

    const base = `/api/school/${AI_TEST_INSIGHTS_SCHOOL.code}/ai-test-insights`;
    expect((await page.request.get(base)).status()).toBe(403);
    expect((await page.request.get(`${base}?centre_id=${ids.nodalCentreId}`)).status()).toBe(403);
    expect((await page.request.get(`${base}?centre_id=${ids.otherCentreId}`)).status()).toBe(403);
  });
});
