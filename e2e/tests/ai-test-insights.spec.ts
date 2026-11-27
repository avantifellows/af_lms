import type { Page } from "@playwright/test";

import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";
import {
  AI_TEST_INSIGHTS_CARDS,
  AI_TEST_INSIGHTS_COE_CENTRE_LIST,
  AI_TEST_INSIGHTS_NOT_LISTED_KEYS,
  AI_TEST_INSIGHTS_NO_CENTRE_SCHOOL,
  AI_TEST_INSIGHTS_NODAL_CENTRE_LIST,
  AI_TEST_INSIGHTS_PERSONAS,
  AI_TEST_INSIGHTS_ROWS,
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

/**
 * Opens the tab and reads its rows as [name, Student ID, Grade, Insight
 * Sessions completed, Test Insights generated, Last Insight Session]; the
 * Open column is left out.
 */
async function listedRows(page: Page): Promise<string[][]> {
  await tabBar(page).getByRole("tab", { name: TAB }).click();
  return shownRows(page);
}

async function shownRows(page: Page): Promise<string[][]> {
  const table = page.getByRole("table", { name: "AI Test Insights students" });
  await expect(table).toBeVisible();
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => {
      const [student, ...rest] = Array.from(row.querySelectorAll("td")).slice(0, -1);
      const [name, code] = Array.from(student.querySelectorAll("div")).map((div) => div.textContent ?? "");
      return [name, code, ...rest.map((cell) => cell.textContent ?? "")];
    }),
  );
}

/** The Student card's heading and its fields as [label, value] pairs, once its newest test line has loaded. */
async function studentCard(page: Page): Promise<{ name: string; fields: string[][] }> {
  const card = page.getByRole("region", { name: "Student" });
  await expect(card).toBeVisible();
  await expect(card.locator("dt:text-is('Newest test') + dd")).not.toHaveText("Loading…");
  const name = (await card.getByRole("heading").textContent()) ?? "";
  const fields = await card.locator("dt").evaluateAll((terms) =>
    terms.map((term) => [term.textContent ?? "", term.nextElementSibling?.textContent ?? ""]),
  );
  return { name, fields };
}

async function expectNotFound(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("region", { name: "Student" })).toHaveCount(0);
}

// A Student Report written by hand. The warehouse is not available in e2e, so,
// as the Performance specs do, the browser's Student Report request is
// answered with it.
const STUDENT_REPORT = {
  student: {
    uid: "0", studentId: "E2E-ATI-ESHA", name: "Esha Ekka", gender: null, category: null, stream: "engineering",
    examStream: "engineering", predicted: "M1", mode: "M2", status: "Improving", latestAl: null,
    toNext: { kind: "none" }, change: null, latestPct: 45, results: {},
    trend: { points: [38, 45], direction: "Improving", slope: 7, recent: 2 },
  },
  chapters: [],
  tests: [
    {
      sessionId: "s3", name: "Major Test 2", date: "2026-10-12", exam: "JEE Main", absent: false, retest: false,
      level: "M2", rank: 4, takers: 38, change: 7,
      overall: { marks: 135, max: 300, pct: 45, correct: 36, wrong: 9, partial: 0, skipped: 30 },
      subjects: [{ subject: "Physics", marks: 40, max: 100, pct: 40, correct: 11, wrong: 4, partial: 0, skipped: 10 }],
    },
    {
      sessionId: "s2", name: "Part Test 3", date: "2026-09-20", exam: "JEE Main", absent: true, retest: false,
      level: null, rank: null, takers: null, change: null, overall: null, subjects: [],
    },
    {
      sessionId: "s1", name: "Major Test 1", date: "2026-08-10", exam: "JEE Main", absent: false, retest: false,
      level: "M3", rank: 9, takers: 40, change: null,
      overall: { marks: 114, max: 300, pct: 38, correct: 30, wrong: 6, partial: 0, skipped: 39 },
      subjects: [],
    },
  ],
};

/** Answers the browser's Student Report request; returns the URLs it asked for. */
async function answerStudentReport(page: Page, status: number, json: unknown): Promise<URL[]> {
  const asked: URL[] = [];
  await page.route("**/api/quiz-analytics/*/student-report?*", async (route) => {
    asked.push(new URL(route.request().url()));
    await route.fulfill({ status, json });
  });
  return asked;
}

// The test picker's answer, written by hand. The warehouse is not available
// in e2e, so the browser's picker request is answered with it.
const PICKER_TESTS = [
  { id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" },
  { id: "T7", name: "Full Syllabus Test 1", date: "2026-10-20", format: "full_syllabus_test" },
  { id: "T4", name: "Major Test 2", date: "2026-10-12", format: "major_test" },
];

/** Answers the browser's test picker request; returns the paths it asked for. */
async function answerTestPicker(page: Page, status: number, json: unknown): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/api/ai-test-insights/students/*/tests", async (route) => {
    asked.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status, json });
  });
  return asked;
}

function expectAfterTeacherFeedback(names: string[]) {
  // Teacher Feedback is not a Teacher's tab; Quiz Sessions comes before it.
  const before = names.includes("Teacher Feedback") ? "Teacher Feedback" : "Quiz Sessions";
  expect(names[names.indexOf(before) + 1]).toBe(TAB);
}

// AI Test Insights Tab (#550, slices #555 and #556): physical centres only.
// The helper seeds a JNV School with an active CoE and Nodal centre, its listed
// Students and one of each kind the tab leaves out, a second School, a School
// with no active centre, the personas the e2e seed lacks, and Insight Sessions
// and Insight Requests whose counts it declares by hand.
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

  test("shows each Student's Insight Sessions, Test Insights and last session, or 0, 0 and no date", async ({
    adminPage,
  }) => {
    await adminPage.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}`);
    const rows = await listedRows(adminPage);

    // Asha: 3 submitted sessions (a newer draft ignored), 2 completed requests
    // (failed, no-data and queued ignored), newest submitted on 14 Nov 2026.
    expect(rows).toContainEqual(["Asha Atiq", "E2E-ATI-ASHA", "11", "3", "2", "14 Nov 2026"]);
    // Divya has only a draft and a failed request; Bhavya has nothing.
    expect(rows).toContainEqual(["Divya Dutt", "E2E-ATI-DIVYA", "12", "0", "0", ""]);
    expect(rows).toContainEqual(["Bhavya Bose", "E2E-ATI-BHAVYA", "12", "0", "0", ""]);
  });

  test("narrows the list by name, Student ID and Grade in the browser, and says when nothing matches", async ({
    adminPage,
  }) => {
    await adminPage.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}`);
    await listedRows(adminPage);
    let listRequests = 0;
    adminPage.on("request", (request) => {
      if (request.url().includes("/ai-test-insights")) listRequests++;
    });
    const search = adminPage.getByRole("searchbox", { name: "Search by name or Student ID" });
    const grade = adminPage.getByRole("combobox", { name: "Grade" });

    await search.fill("chirag");
    expect(await shownRows(adminPage)).toEqual([AI_TEST_INSIGHTS_ROWS.chirag]);

    await search.fill("e2e-ati-divya");
    expect(await shownRows(adminPage)).toEqual([AI_TEST_INSIGHTS_ROWS.divya]);

    await search.fill("");
    await grade.selectOption("12");
    expect(await shownRows(adminPage)).toEqual([AI_TEST_INSIGHTS_ROWS.bhavya, AI_TEST_INSIGHTS_ROWS.divya]);

    await grade.selectOption("11");
    expect(await shownRows(adminPage)).toEqual([
      AI_TEST_INSIGHTS_ROWS.asha,
      AI_TEST_INSIGHTS_ROWS.chirag,
      AI_TEST_INSIGHTS_ROWS.esha,
    ]);

    await search.fill("Divya");
    await expect(adminPage.getByText("No Students match your search.")).toBeVisible();
    await expect(adminPage.getByRole("table", { name: "AI Test Insights students" })).toHaveCount(0);
    await expect(adminPage.getByText("Couldn't load AI Test Insights")).toHaveCount(0);

    await search.fill("");
    await grade.selectOption("All");
    expect(await shownRows(adminPage)).toEqual(AI_TEST_INSIGHTS_SCHOOL_LIST);
    expect(listRequests).toBe(0);
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

  test.describe("Student page", () => {
    const studentUrl = (key: string, centreId?: number) =>
      `/ai-test-insights/students/${ids.studentIds[key]}${centreId === undefined ? "" : `?centre=${centreId}`}`;

    test("opens from the School page and goes back to the School page's tab", async ({ adminPage }) => {
      await adminPage.goto(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}`);
      await listedRows(adminPage);

      await adminPage.getByRole("link", { name: "Open Asha Atiq" }).click();
      await expect(adminPage).toHaveURL(new RegExp(`/ai-test-insights/students/${ids.studentIds.asha}$`));
      expect(await studentCard(adminPage)).toEqual(AI_TEST_INSIGHTS_CARDS.asha);

      await adminPage.getByRole("link", { name: "Back to AI Test Insights" }).click();
      await expect(adminPage).toHaveURL(new RegExp(`/school/${AI_TEST_INSIGHTS_SCHOOL.code}\\?tab=ai_test_insights$`));
      expect(await shownRows(adminPage)).toEqual(AI_TEST_INSIGHTS_SCHOOL_LIST);
    });

    test("opens from a Centre page with that centre, and goes back to the Centre page's tab", async ({ adminPage }) => {
      await adminPage.goto(`/centre/${ids.nodalCentreId}?tab=ai_test_insights`);
      await shownRows(adminPage);

      await adminPage.getByRole("link", { name: "Open Esha Ekka" }).click();
      await expect(adminPage).toHaveURL(
        new RegExp(`/ai-test-insights/students/${ids.studentIds.esha}\\?centre=${ids.nodalCentreId}$`),
      );
      // Esha is on both centres: the Nodal page's Batch is the Nodal one.
      expect(await studentCard(adminPage)).toEqual(AI_TEST_INSIGHTS_CARDS.eshaFromNodal);

      await adminPage.getByRole("link", { name: "Back to AI Test Insights" }).click();
      await expect(adminPage).toHaveURL(new RegExp(`/centre/${ids.nodalCentreId}\\?tab=ai_test_insights$`));
      expect(await shownRows(adminPage)).toEqual(AI_TEST_INSIGHTS_NODAL_CENTRE_LIST);
    });

    test("uses the lowest centre and the School page's tab when no valid centre is named", async ({ adminPage }) => {
      await adminPage.goto(studentUrl("esha"));
      expect(await studentCard(adminPage)).toEqual(AI_TEST_INSIGHTS_CARDS.eshaFromCoe);

      // A centre of another School lists no Student here; it changes nothing.
      await adminPage.goto(studentUrl("esha", ids.otherCentreId));
      expect(await studentCard(adminPage)).toEqual(AI_TEST_INSIGHTS_CARDS.eshaFromCoe);
      await expect(adminPage.getByRole("link", { name: "Back to AI Test Insights" })).toHaveAttribute(
        "href",
        `/school/${AI_TEST_INSIGHTS_SCHOOL.code}?tab=ai_test_insights`,
      );
    });

    test("shows the performance card from the Student Report of the Student's School, Grade and Program", async ({
      adminPage,
    }) => {
      const asked = await answerStudentReport(adminPage, 200, STUDENT_REPORT);
      await adminPage.goto(studentUrl("esha", ids.nodalCentreId));

      const performance = adminPage.getByRole("region", { name: "Performance" });
      const table = performance.getByRole("table");
      await expect(table.locator("tbody tr")).toHaveCount(3);
      expect(await table.locator("tbody tr td:first-child").allTextContents()).toEqual([
        "▸2026-10-12 · Major Test 2",
        "2026-09-20 · Part Test 3",
        "▸2026-08-10 · Major Test 1",
      ]);
      await expect(performance.getByRole("img", { name: "Score trend: Improving over the last 2 tests" })).toBeVisible();
      await expect(performance.getByText("Predicted")).toHaveCount(0);

      await performance.getByRole("button", { name: /Major Test 2/ }).click();
      await expect(table.locator("tbody tr")).toHaveCount(4);
      await expect(table.getByRole("cell", { name: "Physics" })).toBeVisible();

      // Esha opened from the Nodal centre: its School, her Grade, the Nodal Program and her user id.
      const userId = (await pool.query<{ user_id: string }>("SELECT user_id FROM student WHERE id = $1", [ids.studentIds.esha]))
        .rows[0].user_id;
      expect(asked).toHaveLength(1);
      expect(asked[0].pathname).toBe(`/api/quiz-analytics/${AI_TEST_INSIGHTS_SCHOOL.udise}/student-report`);
      expect(Object.fromEntries(asked[0].searchParams)).toEqual({ grade: "11", program: "JNV Nodal", student: String(userId) });
    });

    test('shows "No test results yet" when the Student Report does not find the Student', async ({ adminPage }) => {
      await answerStudentReport(adminPage, 404, { error: "Student not found in this grade" });
      await adminPage.goto(studentUrl("asha"));

      await expect(adminPage.getByRole("region", { name: "Performance" }).getByText("No test results yet")).toBeVisible();
    });

    test("keeps the Student card when the Student Report fails, and Retry asks again", async ({ adminPage }) => {
      const asked = await answerStudentReport(adminPage, 500, { error: "Failed to fetch the student report" });
      await adminPage.goto(studentUrl("asha"));

      const performance = adminPage.getByRole("region", { name: "Performance" });
      await expect(performance.getByRole("alert")).toContainText("Test results could not be loaded");
      expect(await studentCard(adminPage)).toEqual(AI_TEST_INSIGHTS_CARDS.asha);

      await performance.getByRole("button", { name: "Retry" }).click();
      await expect.poll(() => asked.length).toBe(2);
      await expect(performance.getByRole("alert")).toBeVisible();
    });

    test("lists the Student's tests in the AI Summary card with the newest ticked, and shows it as the newest test", async ({
      page,
    }) => {
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
      const asked = await answerTestPicker(page, 200, { tests: PICKER_TESTS });
      await page.goto(studentUrl("asha"));

      const summary = page.getByRole("region", { name: "AI Summary" });
      await expect(summary.getByRole("listitem")).toHaveText([
        "Mock Test 12 Nov 2026 · Mock test",
        "Full Syllabus Test 120 Oct 2026 · Full Syllabus test",
        "Major Test 212 Oct 2026 · Major test",
      ]);
      const mock = summary.getByRole("checkbox", { name: /Mock Test 1/ });
      await expect(mock).toBeChecked();
      await expect(summary.getByRole("checkbox", { name: /Full Syllabus Test 1/ })).not.toBeChecked();
      await expect(summary.getByRole("checkbox", { name: /Major Test 2/ })).not.toBeChecked();
      const card = await studentCard(page);
      expect(card.fields.find(([label]) => label === "Newest test")).toEqual(["Newest test", "Mock Test 1 · 2 Nov 2026"]);

      // The last ticked test stays ticked; once another is ticked it can go.
      await expect(mock).toBeDisabled();
      await summary.getByRole("checkbox", { name: /Major Test 2/ }).check();
      await mock.uncheck();
      await expect(mock).not.toBeChecked();
      await expect(summary.getByRole("checkbox", { name: /Major Test 2/ })).toBeDisabled();

      // One read feeds both the picker and the newest test line.
      expect(asked).toEqual([`/api/ai-test-insights/students/${ids.studentIds.asha}/tests`]);
    });

    test("shows a Program Manager the test picker read-only", async ({ pmPage }) => {
      await answerTestPicker(pmPage, 200, { tests: PICKER_TESTS });
      await pmPage.goto(studentUrl("asha"));

      const checkboxes = pmPage.getByRole("region", { name: "AI Summary" }).getByRole("checkbox");
      await expect(checkboxes).toHaveCount(3);
      for (const checkbox of await checkboxes.all()) await expect(checkbox).toBeDisabled();
      await expect(checkboxes.first()).toBeChecked();
    });

    test("says when the Student has no submitted Major, Full Syllabus or Mock test this year", async ({ adminPage }) => {
      await answerTestPicker(adminPage, 200, { tests: [] });
      await adminPage.goto(studentUrl("asha"));

      await expect(
        adminPage
          .getByRole("region", { name: "AI Summary" })
          .getByText("This student has no submitted Major, Full Syllabus or Mock test this year."),
      ).toBeVisible();
      const card = await studentCard(adminPage);
      expect(card.fields.find(([label]) => label === "Newest test")).toEqual(["Newest test", "—"]);
    });

    test('shows "Tests could not be loaded" when the warehouse is unavailable, and the rest of the page still works', async ({
      adminPage,
    }) => {
      // The picker route is left to the app, whose warehouse e2e does not have.
      await answerStudentReport(adminPage, 200, STUDENT_REPORT);
      await adminPage.goto(studentUrl("asha"));

      const summary = adminPage.getByRole("region", { name: "AI Summary" });
      await expect(summary.getByRole("alert")).toContainText("Tests could not be loaded");
      expect(await studentCard(adminPage)).toEqual(AI_TEST_INSIGHTS_CARDS.asha);
      const performance = adminPage.getByRole("region", { name: "Performance" });
      await expect(performance.getByRole("table").locator("tbody tr")).toHaveCount(3);

      const retried = adminPage.waitForResponse((response) => response.url().endsWith("/tests"));
      await summary.getByRole("button", { name: "Retry" }).click();
      expect((await retried).status()).toBe(502);
      await expect(summary.getByRole("alert")).toContainText("Tests could not be loaded");
    });

    test("answers 404 from the test picker route to a Teacher of another School", async ({ page }) => {
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.otherSchoolTeacher);

      const response = await page.request.get(`/api/ai-test-insights/students/${ids.studentIds.asha}/tests`);

      expect(response.status()).toBe(404);
    });

    test("shows the page to a Teacher, Program Manager, Program Admin and Admin", async ({
      page,
      adminPage,
      pmPage,
      programAdminPage,
    }) => {
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
      for (const viewer of [page, pmPage, programAdminPage, adminPage]) {
        await viewer.goto(studentUrl("chirag"));
        expect(await studentCard(viewer)).toEqual(AI_TEST_INSIGHTS_CARDS.chirag);
      }
    });

    test("is not found for a Teacher of another School, either way round", async ({ page }) => {
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.otherSchoolTeacher);
      await expectNotFound(page, studentUrl("asha"));

      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
      await expectNotFound(page, studentUrl("other"));
    });

    test("keeps a seat-confined Teacher to Students of their own centre", async ({ page }) => {
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.seatedTeacher);

      await page.goto(studentUrl("asha"));
      expect(await studentCard(page)).toEqual(AI_TEST_INSIGHTS_CARDS.asha);
      // Divya is listed only by the Nodal centre of the same School.
      await expectNotFound(page, studentUrl("divya"));
      await expectNotFound(page, studentUrl("divya", ids.nodalCentreId));
    });

    test("is not found for every Student no centre lists, and for a bad or unknown id", async ({ adminPage }) => {
      for (const key of AI_TEST_INSIGHTS_NOT_LISTED_KEYS) {
        await expectNotFound(adminPage, studentUrl(key));
      }
      await expectNotFound(adminPage, "/ai-test-insights/students/abc");
      await expectNotFound(adminPage, "/ai-test-insights/students/999999999");
    });

    test("is not found for a PMU user", async ({ page }) => {
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.pmuManager);

      await expectNotFound(page, studentUrl("asha"));
    });
  });
});
