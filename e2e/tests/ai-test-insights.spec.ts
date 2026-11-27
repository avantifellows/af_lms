import { readFile } from "node:fs/promises";

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
  backdateInsightRequest,
  backdateInsightRequestUpdate,
  endInsightRequestWithoutSummary,
  markInsightRequestRunning,
  readInsightRequestItem,
  readInsightRequests,
  removeAiTestInsightsFixture,
  removeInsightRequestsMadeBySpecs,
  seedAiTestInsightsFixture,
  type AiTestInsightsFixtureIds,
} from "../helpers/ai-test-insights-fixtures";
import {
  endFakeAiMentorshipGuideRequest,
  FAKE_TEST_INSIGHT,
  fakeAiMentorshipGuideCalls,
  resetFakeAiMentorshipGuide,
  steerFakeAiMentorshipGuide,
} from "../helpers/fake-ai-mentorship-guide";
import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "../../src/lib/constants";

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
      // Esha has no Insight Request, so nothing is in progress and the picker is free.
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
      const asked = await answerTestPicker(page, 200, { tests: PICKER_TESTS });
      await page.goto(studentUrl("esha"));

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
      expect(asked).toEqual([`/api/ai-test-insights/students/${ids.studentIds.esha}/tests`]);
    });

    test("shows a Program Manager the test picker read-only", async ({ pmPage }) => {
      await answerTestPicker(pmPage, 200, { tests: PICKER_TESTS });
      await pmPage.goto(studentUrl("esha"));

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

    test.describe("Generate", () => {
      const WAITING = "Waiting to start. This can take about 2 minutes if the server was asleep.";
      const WRITING = "Writing the AI Summary. This usually takes about 4 minutes.";
      const LEAVE = "You can leave this page and come back.";

      /** Opens Bhavya's page as this persona with the picker answered, ready to Generate. */
      async function openBhavya(page: Page) {
        await answerTestPicker(page, 200, { tests: PICKER_TESTS });
        await page.goto(studentUrl("bhavya"));
        const summary = page.getByRole("region", { name: "AI Summary" });
        await expect(summary.getByRole("checkbox", { name: /Mock Test 1/ })).toBeChecked();
        return summary;
      }

      test("records one queued request per Student, whoever clicks, and every page shows it", async ({
        page,
        browser,
      }) => {
        // Three pages open before anyone clicks: the Teacher twice, and a
        // second Teacher (seated at the CoE centre that lists Bhavya).
        await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
        const samePage = await page.context().newPage();
        const otherContext = await browser.newContext();
        const otherPage = await otherContext.newPage();
        await signInAs(otherPage, AI_TEST_INSIGHTS_PERSONAS.seatedTeacher);
        const summary = await openBhavya(page);
        const sameSummary = await openBhavya(samePage);
        const otherSummary = await openBhavya(otherPage);

        await summary.getByRole("checkbox", { name: /Major Test 2/ }).check();
        await summary.getByRole("checkbox", { name: /Full Syllabus Test 1/ }).check();
        await summary.getByRole("button", { name: "Generate" }).click();
        await expect(summary.getByText(WAITING)).toBeVisible();
        await expect(summary.getByText(LEAVE)).toBeVisible();
        await expect(summary.getByText(/^\d+ s elapsed$/)).toBeVisible();
        await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);
        for (const checkbox of await summary.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled();

        const nowSeconds = Date.now() / 1000;
        const rows = await readInsightRequests(pool, ids.studentIds.bhavya);
        expect(rows).toHaveLength(1);
        const [row] = rows;
        expect(row).toMatchObject({
          state: "queued",
          selectedTestIds: ["T9", "T7", "T4"],
          notesSnapshot: [],
          requestedByUserId: ids.personaUserIds[AI_TEST_INSIGHTS_PERSONAS.teacher.email],
          schoolId: ids.schoolId,
          programId: PROGRAM_IDS.COE,
          academicYear: CURRENT_ACADEMIC_YEAR,
        });
        expect(row.requestKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        for (const time of [row.requestedAt, row.insertedAt, row.updatedAt]) {
          expect(Math.abs(time - nowSeconds)).toBeLessThan(60);
        }

        // A second Generate, from the same Teacher and from another, writes
        // nothing and shows the request already waiting, with its tests.
        await sameSummary.getByRole("button", { name: "Generate" }).click();
        await expect(sameSummary.getByText(WAITING)).toBeVisible();
        await otherSummary.getByRole("button", { name: "Generate" }).click();
        await expect(otherSummary.getByText(WAITING)).toBeVisible();
        for (const name of [/Mock Test 1/, /Full Syllabus Test 1/, /Major Test 2/]) {
          await expect(otherSummary.getByRole("checkbox", { name })).toBeChecked();
        }
        expect(await readInsightRequests(pool, ids.studentIds.bhavya)).toHaveLength(1);

        // The waiting state survives a reload.
        await page.reload();
        await expect(summary.getByText(WAITING)).toBeVisible();
        await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);

        // Once the generator claims it, a reload shows it being written.
        await markInsightRequestRunning(pool, row.requestKey);
        await page.reload();
        await expect(summary.getByText(WRITING)).toBeVisible();
        await expect(summary.getByText(LEAVE)).toBeVisible();
        await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);

        await otherContext.close();
      });

      test("shows no Generate to a Program Manager, Program Admin or Admin, and the create route refuses them", async ({
        pmPage,
        programAdminPage,
        adminPage,
      }) => {
        for (const viewer of [pmPage, programAdminPage, adminPage]) {
          await answerTestPicker(viewer, 200, { tests: PICKER_TESTS });
          await viewer.goto(studentUrl("esha"));
          const summary = viewer.getByRole("region", { name: "AI Summary" });
          await expect(summary.getByRole("checkbox", { name: /Mock Test 1/ })).toBeChecked();
          await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);

          const response = await viewer.request.post(`/api/ai-test-insights/students/${ids.studentIds.esha}/requests`, {
            data: { selectedTestIds: ["T9"] },
          });
          expect(response.status()).toBe(403);
        }
        expect(await readInsightRequests(pool, ids.studentIds.esha)).toHaveLength(0);
      });

      test("shows a viewer a request in progress", async ({ pmPage }) => {
        // Chirag's fixture request is running.
        await answerTestPicker(pmPage, 200, { tests: PICKER_TESTS });
        await pmPage.goto(studentUrl("chirag"));

        const summary = pmPage.getByRole("region", { name: "AI Summary" });
        await expect(summary.getByText(WRITING)).toBeVisible();
        await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);
      });
    });

    // A request that ended without an AI Summary (#561): the reason in plain
    // words, and "Try again", which sends the same tests again.
    test.describe("No AI Summary", () => {
      const WAITING = "Waiting to start. This can take about 2 minutes if the server was asleep.";
      const NO_SUMMARY = "No AI Summary could be made";
      const NO_CATEGORY = "This student has no category on record. Add it in Edit Student, then try again.";
      const INTERRUPTED = "The run was interrupted.";
      const GENERAL = "Something went wrong while writing the AI Summary.";

      test("says why after every reload, and Try again makes one new request with the same tests", async ({
        page,
        pmPage,
      }) => {
        // Divya's fixture request failed with a code the table does not hold.
        // The picker stays usable under it: the Teacher picks tests and Generates.
        await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
        await answerTestPicker(page, 200, { tests: PICKER_TESTS });
        await page.goto(studentUrl("divya"));
        const summary = page.getByRole("region", { name: "AI Summary" });
        const tryAgain = summary.getByRole("button", { name: "Try again" });
        await expect(summary.getByText(GENERAL, { exact: true })).toBeVisible();
        await summary.getByRole("checkbox", { name: /Major Test 2/ }).check();
        await summary.getByRole("button", { name: "Generate" }).click();
        await expect(summary.getByText(WAITING)).toBeVisible();
        const fixtureRows = await readInsightRequests(pool, ids.studentIds.divya);
        const first = fixtureRows[fixtureRows.length - 1];
        expect(first).toMatchObject({ state: "queued", selectedTestIds: ["T9", "T4"] });

        // No data, for a Student with no category.
        await endInsightRequestWithoutSummary(pool, first.requestKey, "no_data", "missing_category_for_cutoff");
        await page.reload();
        await expect(summary.getByText(NO_SUMMARY, { exact: true })).toBeVisible();
        await expect(summary.getByText(NO_CATEGORY, { exact: true })).toBeVisible();
        const endedFirst = (await readInsightRequests(pool, ids.studentIds.divya)).find(
          (row) => row.requestKey === first.requestKey,
        );
        expect(endedFirst).toMatchObject({ state: "no_data", outcomeCode: "missing_category_for_cutoff" });

        // Try again: no confirmation, one new queued row with the same tests,
        // and the earlier row left as it was.
        await tryAgain.click();
        await expect(summary.getByText(WAITING)).toBeVisible();
        await expect(tryAgain).toHaveCount(0);
        const afterFirstTry = await readInsightRequests(pool, ids.studentIds.divya);
        expect(afterFirstTry).toHaveLength(fixtureRows.length + 1);
        expect(afterFirstTry.find((row) => row.requestKey === first.requestKey)).toEqual(endedFirst);
        const second = afterFirstTry[afterFirstTry.length - 1];
        expect(second.requestKey).not.toBe(first.requestKey);
        expect(second).toMatchObject({ state: "queued", outcomeCode: null, selectedTestIds: ["T9", "T4"] });

        // Failed, interrupted.
        await endInsightRequestWithoutSummary(pool, second.requestKey, "failed", "interrupted");
        await page.reload();
        await expect(summary.getByText(INTERRUPTED, { exact: true })).toBeVisible();
        await expect(summary.getByText(NO_SUMMARY, { exact: true })).toHaveCount(0);
        await expect(tryAgain).toBeVisible();

        // Failed, with a code the table does not hold.
        await tryAgain.click();
        await expect(summary.getByText(WAITING)).toBeVisible();
        const afterSecondTry = await readInsightRequests(pool, ids.studentIds.divya);
        expect(afterSecondTry).toHaveLength(fixtureRows.length + 2);
        const third = afterSecondTry[afterSecondTry.length - 1];
        expect(third).toMatchObject({ state: "queued", selectedTestIds: ["T9", "T4"] });
        await endInsightRequestWithoutSummary(pool, third.requestKey, "failed", "llm_quota_exhausted");
        await page.reload();
        await expect(summary.getByText(GENERAL, { exact: true })).toBeVisible();
        await expect(summary.getByText(INTERRUPTED, { exact: true })).toHaveCount(0);
        await expect(tryAgain).toBeVisible();

        // A viewer, in a browser of their own, sees the reason and no Try again.
        await answerTestPicker(pmPage, 200, { tests: PICKER_TESTS });
        await pmPage.goto(studentUrl("divya"));
        const viewerSummary = pmPage.getByRole("region", { name: "AI Summary" });
        await expect(viewerSummary.getByText(GENERAL, { exact: true })).toBeVisible();
        await expect(viewerSummary.getByRole("button", { name: "Try again" })).toHaveCount(0);
        await expect(viewerSummary.getByRole("button", { name: "Generate" })).toHaveCount(0);
      });
    });

    // Delivery to AI Mentorship Guide (#562): after the row is written the
    // LMS wakes the generator and enqueues the request. The fake generator
    // stands in for it; Esha has no request, and each test removes the ones it
    // made.
    test.describe("Delivery to AI Mentorship Guide", () => {
      const WAITING = "Waiting to start. This can take about 2 minutes if the server was asleep.";
      const GENERAL = "Something went wrong while writing the AI Summary.";
      // The fake's settings, written by hand (fake-ai-mentorship-guide.json).
      const BEARER = "Bearer e2e-fake-ai-test-insights-enqueue-secret";
      const BODY = '{"environment":"staging"}';

      test.beforeEach(async () => {
        await resetFakeAiMentorshipGuide();
      });

      test.afterEach(async () => {
        await resetFakeAiMentorshipGuide();
        await removeInsightRequestsMadeBySpecs(pool, ids.studentIds.esha);
      });

      /** Opens Esha's page as the Teacher with the picker answered, and presses Generate. */
      async function generateForEsha(page: Page) {
        await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.teacher);
        await answerTestPicker(page, 200, { tests: PICKER_TESTS });
        await page.goto(studentUrl("esha"));
        const summary = page.getByRole("region", { name: "AI Summary" });
        await expect(summary.getByRole("checkbox", { name: /Mock Test 1/ })).toBeChecked();
        await summary.getByRole("button", { name: "Generate" }).click();
        return summary;
      }

      test("wakes the generator and enqueues the request once, with the secret and the environment, and it stays queued", async ({
        page,
      }) => {
        const summary = await generateForEsha(page);
        await expect(summary.getByText(WAITING)).toBeVisible();

        const rows = await readInsightRequests(pool, ids.studentIds.esha);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ state: "queued", outcomeCode: null, finishedAt: null });
        expect(await fakeAiMentorshipGuideCalls()).toEqual([
          { kind: "wake", requestKey: null, authorization: null, body: "", status: 202 },
          { kind: "enqueue", requestKey: rows[0].requestKey, authorization: BEARER, body: BODY, status: 202 },
        ]);
      });

      test("keeps the request queued and waiting while the generator is asleep, after a reload too", async ({ page }) => {
        await steerFakeAiMentorshipGuide({ enqueue: "asleep" });

        const summary = await generateForEsha(page);
        await expect(summary.getByText(WAITING)).toBeVisible();
        const rows = await readInsightRequests(pool, ids.studentIds.esha);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ state: "queued", outcomeCode: null });
        const enqueues = (await fakeAiMentorshipGuideCalls()).filter((call) => call.kind === "enqueue");
        expect(enqueues).toEqual([
          { kind: "enqueue", requestKey: rows[0].requestKey, authorization: BEARER, body: BODY, status: 503 },
        ]);

        await page.reload();
        await expect(summary.getByText(WAITING)).toBeVisible();
        await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);
        expect(await readInsightRequests(pool, ids.studentIds.esha)).toEqual(rows);
      });

      test("marks a request the generator rejects failed, and the card offers Try again", async ({ page }) => {
        await steerFakeAiMentorshipGuide({ enqueue: "reject", status: 422 });

        const summary = await generateForEsha(page);
        await expect(summary.getByText(GENERAL, { exact: true })).toBeVisible();
        await expect(summary.getByRole("button", { name: "Try again" })).toBeVisible();
        await expect(summary.getByText(WAITING)).toHaveCount(0);

        const nowSeconds = Date.now() / 1000;
        const rows = await readInsightRequests(pool, ids.studentIds.esha);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ state: "failed", outcomeCode: "enqueue_rejected" });
        expect(Math.abs((rows[0].finishedAt as number) - nowSeconds)).toBeLessThan(60);
        expect(Math.abs(rows[0].updatedAt - nowSeconds)).toBeLessThan(60);

        await page.reload();
        await expect(summary.getByText(GENERAL, { exact: true })).toBeVisible();
        await expect(summary.getByRole("button", { name: "Try again" })).toBeVisible();
      });

      // The page follows a request by itself (#563): it polls every 10
      // seconds while the request is queued or running, and a Teacher's poll
      // re-delivers a request whose first enqueue call was missed.
      test.describe("Following a request", () => {
        const WRITING = "Writing the AI Summary. This usually takes about 4 minutes.";
        const NO_SUMMARY = "No AI Summary could be made";
        const NO_CATEGORY = "This student has no category on record. Add it in Edit Student, then try again.";
        const INTERRUPTED = "The run was interrupted.";
        // Up to two 10-second polls.
        const POLLED = { timeout: 25_000 };

        const enqueueCalls = async () => (await fakeAiMentorshipGuideCalls()).filter((call) => call.kind === "enqueue");
        const statusPath = (requestKey: string) =>
          `/api/ai-test-insights/students/${ids.studentIds.esha}/requests/${requestKey}`;

        test("re-delivers a request the asleep generator missed, on a Teacher's poll only, and the page moves to writing", async ({
          page,
          pmPage,
        }) => {
          test.slow();
          await steerFakeAiMentorshipGuide({ enqueue: "asleep" });
          const summary = await generateForEsha(page);
          await expect(summary.getByText(WAITING)).toBeVisible();
          const [request] = await readInsightRequests(pool, ids.studentIds.esha);
          expect(await enqueueCalls()).toHaveLength(1);

          // The generator wakes. The Teacher leaves; the request was last
          // touched over 30 seconds ago (back-dated, so as not to wait).
          await steerFakeAiMentorshipGuide({ enqueue: "accept", run: "hold" });
          await page.goto("about:blank");
          await backdateInsightRequestUpdate(pool, request.requestKey, 60);

          // A viewer's poll never re-delivers.
          await answerTestPicker(pmPage, 200, { tests: PICKER_TESTS });
          const viewerPoll = pmPage.waitForResponse(
            (response) => new URL(response.url()).pathname === statusPath(request.requestKey),
            POLLED,
          );
          await pmPage.goto(studentUrl("esha"));
          await expect(pmPage.getByRole("region", { name: "AI Summary" }).getByText(WAITING)).toBeVisible();
          expect((await viewerPoll).status()).toBe(200);
          expect(await enqueueCalls()).toHaveLength(1);
          await pmPage.goto("about:blank");

          // The Teacher's page polls, re-delivers once, and the generator
          // claims the request: waiting, then writing, with no reload.
          await page.goto(studentUrl("esha"));
          await expect(summary.getByText(WAITING)).toBeVisible();
          await expect(summary.getByText(WRITING)).toBeVisible(POLLED);
          await expect(summary.getByText(WAITING)).toHaveCount(0);
          expect(await enqueueCalls()).toEqual([
            { kind: "enqueue", requestKey: request.requestKey, authorization: BEARER, body: BODY, status: 503 },
            { kind: "enqueue", requestKey: request.requestKey, authorization: BEARER, body: BODY, status: 202 },
          ]);
          const nowSeconds = Date.now() / 1000;
          const [claimed] = await readInsightRequests(pool, ids.studentIds.esha);
          expect(claimed).toMatchObject({ requestKey: request.requestKey, state: "running", outcomeCode: null });
          expect(Math.abs((claimed.startedAt as number) - nowSeconds)).toBeLessThan(60);
          expect(Math.abs(claimed.updatedAt - nowSeconds)).toBeLessThan(60);

          // Running survives a reload.
          await page.reload();
          await expect(summary.getByText(WRITING)).toBeVisible();
          await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);
        });

        test("shows why a request ended without an AI Summary, and Try again, with no reload", async ({ page }) => {
          test.slow();
          await steerFakeAiMentorshipGuide({ enqueue: "accept", run: "hold" });
          const summary = await generateForEsha(page);
          const tryAgain = summary.getByRole("button", { name: "Try again" });
          await expect(summary.getByText(WRITING)).toBeVisible(POLLED);
          const [first] = await readInsightRequests(pool, ids.studentIds.esha);
          expect(first.state).toBe("running");

          // The generator ends it with no data.
          await endFakeAiMentorshipGuideRequest(first.requestKey, {
            state: "no_data",
            outcomeCode: "missing_category_for_cutoff",
          });
          await expect(summary.getByText(NO_SUMMARY, { exact: true })).toBeVisible(POLLED);
          await expect(summary.getByText(NO_CATEGORY, { exact: true })).toBeVisible();
          await expect(tryAgain).toBeVisible();
          await expect(summary.getByText(WRITING)).toHaveCount(0);

          // Try again, and this time the generator fails it as soon as it starts.
          await steerFakeAiMentorshipGuide({ enqueue: "accept", run: "failed", outcomeCode: "interrupted" });
          await tryAgain.click();
          await expect(summary.getByText(INTERRUPTED, { exact: true })).toBeVisible(POLLED);
          await expect(tryAgain).toBeVisible();
          await expect(summary.getByText(NO_SUMMARY, { exact: true })).toHaveCount(0);

          const nowSeconds = Date.now() / 1000;
          const rows = await readInsightRequests(pool, ids.studentIds.esha);
          expect(rows).toHaveLength(2);
          expect(rows[0]).toMatchObject({ state: "no_data", outcomeCode: "missing_category_for_cutoff" });
          expect(rows[1]).toMatchObject({ state: "failed", outcomeCode: "interrupted", selectedTestIds: ["T9"] });
          for (const row of rows) {
            expect(Math.abs((row.finishedAt as number) - nowSeconds)).toBeLessThan(90);
            expect(Math.abs((row.startedAt as number) - nowSeconds)).toBeLessThan(90);
          }
        });
      });

      // A stalled request (#566): one still queued or running 20 minutes after
      // it was made reads as failed with timed_out. A read leaves the row as
      // it is; the next Generate ("Try again") closes it. Requests are
      // back-dated, so as not to wait 20 minutes.
      test.describe("A request that stalled", () => {
        const WRITING = "Writing the AI Summary. This usually takes about 4 minutes.";
        const TIMED_OUT = "The AI Summary took too long and was stopped.";
        // Up to two 10-second polls.
        const POLLED = { timeout: 25_000 };
        const statusPath = (requestKey: string) =>
          `/api/ai-test-insights/students/${ids.studentIds.esha}/requests/${requestKey}`;

        test("shows a request 20 minutes old as failed with Try again, after a reload too, and Try again closes it and makes one new request", async ({
          page,
        }) => {
          test.slow();
          await steerFakeAiMentorshipGuide({ enqueue: "accept", run: "hold" });
          const summary = await generateForEsha(page);
          const tryAgain = summary.getByRole("button", { name: "Try again" });
          await expect(summary.getByText(WRITING)).toBeVisible(POLLED);
          const [stalled] = await readInsightRequests(pool, ids.studentIds.esha);
          expect(stalled).toMatchObject({ state: "running", selectedTestIds: ["T9"] });

          // The page is still following it: the next poll reads it as failed,
          // and the card stops polling.
          await backdateInsightRequest(pool, stalled.requestKey, 20);
          await expect(summary.getByText(TIMED_OUT, { exact: true })).toBeVisible(POLLED);
          await expect(tryAgain).toBeVisible();
          await expect(summary.getByText(WRITING)).toHaveCount(0);
          let polls = 0;
          page.on("request", (request) => {
            if (new URL(request.url()).pathname === statusPath(stalled.requestKey)) polls += 1;
          });
          await page.waitForTimeout(12_000);
          expect(polls).toBe(0);

          // A reload shows the same, and no read changed the row.
          await page.reload();
          await expect(summary.getByText(TIMED_OUT, { exact: true })).toBeVisible();
          await expect(tryAgain).toBeVisible();
          expect(await readInsightRequests(pool, ids.studentIds.esha)).toEqual([
            expect.objectContaining({ requestKey: stalled.requestKey, state: "running", outcomeCode: null, finishedAt: null }),
          ]);

          // Try again: the stalled row ends failed with timed_out, and exactly
          // one new row is made with the same tests.
          await steerFakeAiMentorshipGuide({ enqueue: "accept" });
          await tryAgain.click();
          await expect(summary.getByText("Waiting to start. This can take about 2 minutes if the server was asleep.")).toBeVisible();
          await expect(tryAgain).toHaveCount(0);
          const nowSeconds = Date.now() / 1000;
          const rows = await readInsightRequests(pool, ids.studentIds.esha);
          expect(rows).toHaveLength(2);
          expect(rows[0]).toMatchObject({ requestKey: stalled.requestKey, state: "failed", outcomeCode: "timed_out" });
          expect(Math.abs((rows[0].finishedAt as number) - nowSeconds)).toBeLessThan(60);
          expect(Math.abs(rows[0].updatedAt - nowSeconds)).toBeLessThan(60);
          expect(rows[1].requestKey).not.toBe(stalled.requestKey);
          expect(rows[1]).toMatchObject({ state: "queued", outcomeCode: null, selectedTestIds: ["T9"] });
        });

        test("re-delivers nothing on a Teacher's poll of a stalled queued request", async ({ page }) => {
          await steerFakeAiMentorshipGuide({ enqueue: "asleep" });
          const summary = await generateForEsha(page);
          await expect(summary.getByText("Waiting to start. This can take about 2 minutes if the server was asleep.")).toBeVisible();
          const [stalled] = await readInsightRequests(pool, ids.studentIds.esha);
          await page.goto("about:blank");
          // Last touched long enough ago for a re-delivery, and made 20 minutes ago.
          await backdateInsightRequestUpdate(pool, stalled.requestKey, 60);
          await backdateInsightRequest(pool, stalled.requestKey, 20);
          await resetFakeAiMentorshipGuide();

          const response = await page.request.get(statusPath(stalled.requestKey));

          expect(response.status()).toBe(200);
          expect((await response.json()).request).toMatchObject({
            requestKey: stalled.requestKey,
            state: "failed",
            outcomeCode: "timed_out",
          });
          expect(await fakeAiMentorshipGuideCalls()).toEqual([]);
          const [row] = await readInsightRequests(pool, ids.studentIds.esha);
          expect(row).toMatchObject({ state: "queued", outcomeCode: null, finishedAt: null });
        });

        test("shows the AI Summary when the generator finishes a stalled request nobody retried", async ({ page }) => {
          test.slow();
          await steerFakeAiMentorshipGuide({ enqueue: "accept", run: "hold" });
          const summary = await generateForEsha(page);
          await expect(summary.getByText(WRITING)).toBeVisible(POLLED);
          const [stalled] = await readInsightRequests(pool, ids.studentIds.esha);
          await backdateInsightRequest(pool, stalled.requestKey, 20);
          await page.reload();
          await expect(summary.getByText(TIMED_OUT, { exact: true })).toBeVisible();

          // The generator finishes it late; nobody pressed Try again.
          await endFakeAiMentorshipGuideRequest(stalled.requestKey, { state: "completed" });
          await page.reload();
          const text = summary.getByRole("article", { name: "AI Summary text" });
          await expect(text.getByRole("heading", { name: "Where the student stands" })).toBeVisible();
          await expect(summary.getByText(TIMED_OUT, { exact: true })).toHaveCount(0);
          await expect(summary.getByRole("link", { name: "Download PDF" })).toBeVisible();
          const rows = await readInsightRequests(pool, ids.studentIds.esha);
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ requestKey: stalled.requestKey, state: "completed", outcomeCode: null });
        });
      });

      // A finished request (#564): the card reads the AI Summary text from
      // the fake's object store through the summary route and shows it
      // formatted, with the tests it was made from, who asked and when.
      // "Download PDF" (#565) saves the fixed PDF the fake "uploaded".
      test.describe("AI Summary", () => {
        // Up to two 10-second polls.
        const POLLED = { timeout: 25_000 };
        // The fixed Test Insight's headings and table, written by hand
        // (fake-ai-test-insight.json).
        const TABLE_ROWS = [
          "Subject Mock Test 1 Major Test 2",
          "Physics 62 48",
          "Chemistry 51 50",
          "Mathematics 70 66",
        ];

        const enqueueOrWakeCalls = async () => (await fakeAiMentorshipGuideCalls()).length;
        const summaryRoute = (requestKey: string) =>
          `/api/ai-test-insights/students/${ids.studentIds.esha}/requests/${requestKey}/summary`;

        /**
         * Downloads the PDF through the card's "Download PDF" link (#565) and
         * checks it holds the fixed PDF bytes, saved under `fileName`.
         */
        async function expectFixedPdfDownload(page: Page, summary: ReturnType<Page["getByRole"]>, fileName: string) {
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            summary.getByRole("link", { name: "Download PDF" }).click(),
          ]);
          expect(download.suggestedFilename()).toBe(fileName);
          const bytes = await readFile((await download.path())!);
          expect(bytes.equals(Buffer.from(FAKE_TEST_INSIGHT.pdf, "latin1"))).toBe(true);
        }

        /** Checks the card shows the fixed Test Insight as formatted text. */
        async function expectFixedText(summary: ReturnType<Page["getByRole"]>, options?: { timeout: number }) {
          const text = summary.getByRole("article", { name: "AI Summary text" });
          await expect(text.getByRole("heading", { name: "Where the student stands" })).toBeVisible(options);
          await expect(text.getByRole("heading", { name: "Next steps" })).toBeVisible();
          await expect(text.getByRole("listitem").first()).toHaveText("Physics rose from 48 to 62 across the two tests.");
          const rows = await text.getByRole("table").getByRole("row").allInnerTexts();
          expect(rows.map((row) => row.split(/\s+/).join(" ").trim())).toEqual(TABLE_ROWS);
        }

        test("shows the finished AI Summary by itself, and again after a reload without waking the generator", async ({
          page,
        }) => {
          test.slow();
          await steerFakeAiMentorshipGuide({ enqueue: "accept", run: "complete" });
          const summary = await generateForEsha(page);

          // The fake completes it; the page shows it with no reload.
          await expectFixedText(summary, POLLED);
          await expect(summary.getByText("Made from: Mock Test 1", { exact: true })).toBeVisible();
          await expect(summary.getByRole("button", { name: "Generate" })).toBeVisible();

          // The fake wrote what AI Mentorship Guide writes.
          const [request] = await readInsightRequests(pool, ids.studentIds.esha);
          expect(request).toMatchObject({ state: "completed", outcomeCode: null, selectedTestIds: ["T9"] });
          const item = await readInsightRequestItem(pool, request.requestKey);
          expect(item).not.toBeNull();
          const folder = `acad-mentorship/staging/items/${item!.itemId}`;
          expect(item).toMatchObject({ studentId: ids.studentIds.esha, status: "completed", sessionStatus: "completed" });
          expect(item!.files).toEqual([
            {
              fileKind: "report",
              logicalPath: "output/final-report.md",
              s3Key: `${folder}/output/final-report.md`,
              mimeType: "text/markdown",
              byteSize: Buffer.byteLength(FAKE_TEST_INSIGHT.markdown),
            },
            {
              fileKind: "report_pdf",
              logicalPath: "output/report.pdf",
              s3Key: `${folder}/output/report.pdf`,
              mimeType: "application/pdf",
              byteSize: Buffer.byteLength(FAKE_TEST_INSIGHT.pdf),
            },
          ]);
          const response = await page.request.get(summaryRoute(request.requestKey));
          expect(response.status()).toBe(200);
          expect(await response.json()).toEqual({ markdown: FAKE_TEST_INSIGHT.markdown });

          // Who asked and when: the request's time, set to a known moment
          // (05:30 UTC is 11:00 in India).
          await pool.query(
            `UPDATE ai_test_insight_requests SET requested_at = '2026-11-27 05:30:00' WHERE request_key = $1`,
            [request.requestKey],
          );
          const callsBefore = await enqueueOrWakeCalls();
          await page.reload();
          await expectFixedText(summary);
          await expect(summary.getByText("Made from: Mock Test 1", { exact: true })).toBeVisible();
          await expect(
            summary.getByText("Asked for by E2E ATI Teacher on 27 Nov 2026, 11:00", { exact: true }),
          ).toBeVisible();

          // The PDF the generator made, named by the Student's id and the
          // request's date, never the Student's name.
          await expectFixedPdfDownload(page, summary, `ai-summary-${ids.studentIds.esha}-2026-11-27.pdf`);
          expect(await enqueueOrWakeCalls()).toBe(callsBefore);
        });

        test("shows a Program Manager, Program Admin and Admin the AI Summary and its PDF, with no Generate", async ({
          browser,
          pmPage,
          programAdminPage,
          adminPage,
        }) => {
          test.slow();
          await steerFakeAiMentorshipGuide({ enqueue: "accept", run: "complete" });
          // The Teacher asks in a browser of their own: adminPage is the test's `page`.
          const teacherContext = await browser.newContext();
          const teacherSummary = await generateForEsha(await teacherContext.newPage());
          await expectFixedText(teacherSummary, POLLED);
          await teacherContext.close();
          // 20:30 UTC on 27 Nov is 28 Nov in India.
          const [request] = await readInsightRequests(pool, ids.studentIds.esha);
          await pool.query(
            `UPDATE ai_test_insight_requests SET requested_at = '2026-11-27 20:30:00' WHERE request_key = $1`,
            [request.requestKey],
          );
          const callsBefore = await enqueueOrWakeCalls();

          for (const viewer of [pmPage, programAdminPage, adminPage]) {
            await answerTestPicker(viewer, 200, { tests: PICKER_TESTS });
            await viewer.goto(studentUrl("esha"));
            const summary = viewer.getByRole("region", { name: "AI Summary" });
            await expectFixedText(summary);
            await expect(summary.getByText("Made from: Mock Test 1", { exact: true })).toBeVisible();
            await expect(summary.getByText(/^Asked for by E2E ATI Teacher on /)).toBeVisible();
            await expect(summary.getByRole("button", { name: "Generate" })).toHaveCount(0);
            await expectFixedPdfDownload(viewer, summary, `ai-summary-${ids.studentIds.esha}-2026-11-28.pdf`);
          }
          expect(await enqueueOrWakeCalls()).toBe(callsBefore);
        });
      });
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

    test("is not found for a Teacher of another School, either way round", async ({ page, browser }) => {
      await signInAs(page, AI_TEST_INSIGHTS_PERSONAS.otherSchoolTeacher);
      await expectNotFound(page, studentUrl("asha"));

      // The second Teacher signs in in a browser of their own: the first
      // page's session refresh can re-set its cookie after a switch.
      const teacherContext = await browser.newContext();
      const teacherPage = await signInAs(await teacherContext.newPage(), AI_TEST_INSIGHTS_PERSONAS.teacher);
      await expectNotFound(teacherPage, studentUrl("other"));
      await teacherContext.close();
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
