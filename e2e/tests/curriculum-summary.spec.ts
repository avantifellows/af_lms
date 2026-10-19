import type { Browser, Page } from "@playwright/test";
import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

// Curriculum Summary v2 (#426): one row per Summary Class measured against its Curriculum Plan.
// Fixture: e2e/fixtures/migrations/20261019130000_seed_curriculum_summary_fixture.sql. Every
// expected pill and header number below is worked out by hand from those rows with as_of pinned.
//
// "Summary G11 Active Plan" (JEE Main + NEET) due dates: Alpha Physics 06-30, Beta Physics 07-31,
// Chem Bonding 07-15, Chem Thermo 09-30, Bio Cells 06-15, Bio Plants 07-10, Bio Animals 08-10,
// Bio Genetics 08-12. Alpha is in the JEE Main, JEE Advanced and NEET syllabus, Beta in JEE Main
// only; the Chemistry and Biology Chapters are NEET only.

const AS_OF = "2026-08-15";

// Level 2 PM scoped to region SUMMARY_E2E, CoE + Nodal; seeded for this spec only.
const SUMMARY_PM = { name: "E2E Summary PM", email: "e2e-summary-pm@test.local" };

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    await pool.query(
      `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only)
       VALUES ($1, 2, 'program_manager', ARRAY[1, 2]::integer[], NULL, ARRAY['SUMMARY_E2E']::text[], false)
       ON CONFLICT (email) DO UPDATE SET
         level = 2, role = 'program_manager', program_ids = ARRAY[1, 2]::integer[],
         school_codes = NULL, regions = ARRAY['SUMMARY_E2E']::text[], read_only = false, revoked_at = NULL`,
      [SUMMARY_PM.email]
    );
  } finally {
    await pool.end();
  }
});

test.afterAll(async () => {
  const pool = getTestPool();
  try {
    await pool.query("DELETE FROM user_permission WHERE email = $1", [SUMMARY_PM.email]);
  } finally {
    await pool.end();
  }
});

async function summaryPmPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, SUMMARY_PM);
  return page;
}

function summaryRow(page: Page, centre: string) {
  return page.locator(`[data-summary-row][data-centre="${centre}"]`);
}

function rowCentres(page: Page): Promise<string[]> {
  return page
    .locator("[data-summary-row]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-centre") ?? ""));
}

function pill(page: Page, centre: string, subject: string) {
  return summaryRow(page, centre).locator(`[data-subject="${subject}"]`);
}

// PCM Behind / PCB Behind cell: its label ("—" where the group doesn't apply) and pill tone.
async function expectGroup(
  page: Page,
  centre: string,
  group: "PCM" | "PCB",
  label: string,
  tone?: "green" | "amber" | "red"
) {
  const cell = summaryRow(page, centre).locator(`[data-subject-group="${group}"]`);
  await expect(cell).toHaveText(label);
  if (tone) await expect(cell.locator("[data-tone]")).toHaveAttribute("data-tone", tone);
  else await expect(cell.locator("[data-tone]")).toHaveCount(0);
}

// Header PCM and PCB chapters behind.
async function expectChaptersBehind(page: Page, pcm: string, pcb: string) {
  await expect(page.getByTestId("summary-pcm-chapters-behind")).toHaveText(pcm);
  await expect(page.getByTestId("summary-pcb-chapters-behind")).toHaveText(pcb);
}

test.describe("Curriculum Summary", () => {
  test("a shared JEE Main + NEET Centre has one row and counts each Chapter once", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);

    const shared = summaryRow(page, "Summary E2E Anand Shared");
    await expect(shared).toHaveCount(1);
    await expect(shared).toContainText("JNV Nodal");
    await expect(shared).toContainText("JEE Main + NEET");
    await expect(shared).toContainText("SUMMARY_E2E");
    // Physics: Alpha (done under both tracks, counted once) and Beta (done under NEET).
    await expect(pill(page, "Summary E2E Anand Shared", "Physics")).toHaveText("On track · 2/2");
    await expect(pill(page, "Summary E2E Anand Shared", "Physics").locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "green"
    );
    // Chemistry: Bonding due, not done; Thermo not yet due (its early completion counts nowhere).
    await expect(pill(page, "Summary E2E Anand Shared", "Chemistry")).toHaveText("1 behind · 0/1");
    await expect(pill(page, "Summary E2E Anand Shared", "Chemistry").locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "amber"
    );
    await expect(pill(page, "Summary E2E Anand Shared", "Maths")).toHaveText("—");
    // Biology: Cells done; Plants completed 01:30 IST on 16 Aug (after as-of); Animals, Genetics open.
    await expect(pill(page, "Summary E2E Anand Shared", "Biology")).toHaveText("3 behind · 1/4");
    await expect(pill(page, "Summary E2E Anand Shared", "Biology").locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "red"
    );
    // PCM = Physics 0 + Chemistry 1 (no Maths); PCB = Physics 0 + Chemistry 1 + Biology 3.
    await expectGroup(page, "Summary E2E Anand Shared", "PCM", "1 behind", "amber");
    await expectGroup(page, "Summary E2E Anand Shared", "PCB", "4 behind", "red");
    await expect(shared.locator("[data-plan]")).toHaveText("Summary G11 Active Plan");
    await page.context().close();
  });

  test("Done counts only completions within the plan's academic year up to the as-of date", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);
    // Anand Main (JEE Main): Beta's only completion is from 20 Mar 2026, last academic year.
    await expect(pill(page, "Summary E2E Anand Main", "Physics")).toHaveText("1 behind · 1/2");
    // Bhuj Neet (NEET only): Beta is JEE Main only, so Physics is Alpha alone; no Maths content.
    await expect(pill(page, "Summary E2E Bhuj Neet", "Physics")).toHaveText("On track · 1/1");
    await expect(pill(page, "Summary E2E Bhuj Neet", "Chemistry")).toHaveText("On track · 1/1");
    await expect(pill(page, "Summary E2E Bhuj Neet", "Maths")).toHaveText("—");
    await expect(pill(page, "Summary E2E Bhuj Neet", "Biology")).toHaveText("On track · 4/4");

    // Five days later Anand Shared's Bio Plants completion (16 Aug IST) has happened.
    await page.goto("/curriculum-summary?as_of=2026-08-20");
    await expect(pill(page, "Summary E2E Anand Shared", "Biology")).toHaveText("2 behind · 2/4");
    await expect(pill(page, "Summary E2E Anand Shared", "Biology").locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "amber"
    );
    await expectGroup(page, "Summary E2E Anand Shared", "PCM", "1 behind", "amber");
    await expectGroup(page, "Summary E2E Anand Shared", "PCB", "3 behind", "red");

    // On 1 Jul only Alpha (30 Jun) and Bio Cells (15 Jun) were due, and both were done.
    await page.goto("/curriculum-summary?as_of=2026-07-01");
    await expect(pill(page, "Summary E2E Anand Shared", "Physics")).toHaveText("On track · 1/1");
    await expect(pill(page, "Summary E2E Anand Shared", "Chemistry")).toHaveText("On track · 0/0");
    await expect(pill(page, "Summary E2E Anand Shared", "Biology")).toHaveText("On track · 1/1");
    await expectGroup(page, "Summary E2E Anand Shared", "PCM", "On track", "green");
    await expectGroup(page, "Summary E2E Anand Shared", "PCB", "On track", "green");
    await page.context().close();
  });

  test("PCM Behind and PCB Behind follow each row's tracks", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);

    // JEE Main rows show PCM only: Anand Main and Vapi Closed have Beta Physics open.
    await expectGroup(page, "Summary E2E Anand Main", "PCM", "1 behind", "amber");
    await expectGroup(page, "Summary E2E Anand Main", "PCB", "—");
    await expectGroup(page, "Summary E2E Vapi Closed", "PCM", "1 behind", "amber");
    await expectGroup(page, "Summary E2E Vapi Closed", "PCB", "—");
    // A NEET row shows PCB only; everything due at Bhuj Neet is done.
    await expectGroup(page, "Summary E2E Bhuj Neet", "PCM", "—");
    await expectGroup(page, "Summary E2E Bhuj Neet", "PCB", "On track", "green");
    // No plan rows keep "Not measured" across the subject and group columns.
    await expect(summaryRow(page, "Summary E2E Surat Draft").locator("[data-subject-group]")).toHaveCount(0);
    await expect(summaryRow(page, "Summary E2E Surat Draft")).toContainText("Not measured without an Active plan");
    await expect(summaryRow(page, "Summary E2E Bhuj Setup").locator("[data-subject-group]")).toHaveCount(0);
    for (const header of ["PCM Behind", "PCB Behind"]) {
      await expect(page.getByRole("columnheader", { name: header, exact: true })).toHaveCount(1);
    }
    await expect(page.getByRole("columnheader", { name: "Behind", exact: true })).toHaveCount(0);

    // On 1 Oct Chem Thermo (due 30 Sep) is due: Bhuj Neet hasn't completed it, while Anand
    // Shared completed it early on 1 Aug. Anand Shared PCB = Chem Bonding 1 + Bio Animals and
    // Genetics 2 (Plants was completed on 16 Aug).
    await page.goto("/curriculum-summary?as_of=2026-10-01");
    await expectGroup(page, "Summary E2E Bhuj Neet", "PCM", "—");
    await expectGroup(page, "Summary E2E Bhuj Neet", "PCB", "1 behind", "amber");
    await expectGroup(page, "Summary E2E Anand Shared", "PCM", "1 behind", "amber");
    await expectGroup(page, "Summary E2E Anand Shared", "PCB", "3 behind", "red");
    await expectGroup(page, "Summary E2E Anand Main", "PCM", "1 behind", "amber");
    // PCM: Anand Shared 1 + Anand Main 1 + Vapi Closed 1; PCB: Anand Shared 3 + Bhuj Neet 1.
    await expectChaptersBehind(page, "3", "4");
    await page.context().close();
  });

  test("setup-error, no-content and ambiguous-Centre rows show their state instead of metrics", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);

    const setup = summaryRow(page, "Summary E2E Bhuj Setup");
    await expect(setup).toContainText("JEE Main + JEE Advanced");
    await expect(setup).toContainText("Fix tracks in Centre Management");
    await expect(setup.locator("[data-subject]")).toHaveCount(0);

    const cet = summaryRow(page, "Summary E2E Surat CET");
    await expect(cet).toContainText("CET");
    await expect(cet).toContainText("Curriculum configuration is unavailable");
    await expect(cet.locator("[data-subject]")).toHaveCount(0);

    await expect(summaryRow(page, "Summary E2E Navsari One")).toContainText(
      "Multiple active physical Centres are configured for this School and Program"
    );
    // Navsari Two maps no Exam Track, so it has no row of its own.
    await expect(summaryRow(page, "Summary E2E Navsari Two")).toHaveCount(0);
    await page.context().close();
  });

  test("Draft-assigned and unassigned Centres show No plan; a plan past closure is labelled Closed", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);

    for (const centre of ["Summary E2E Surat Draft", "Summary E2E Vapi Unassigned"]) {
      await expect(summaryRow(page, centre).locator("[data-plan]")).toHaveText("No plan");
      await expect(summaryRow(page, centre).locator("[data-subject]")).toHaveCount(0);
    }

    // Closed 31 Jul; Alpha's 5 Aug completion still counts, Beta (due 20 Jul) is open.
    const closed = summaryRow(page, "Summary E2E Vapi Closed");
    await expect(closed.locator("[data-plan]")).toContainText("Summary G11 Closed Plan");
    await expect(closed.locator("[data-plan-closed]")).toHaveText("Closed");
    await expect(pill(page, "Summary E2E Vapi Closed", "Physics")).toHaveText("1 behind · 1/2");
    await expect(summaryRow(page, "Summary E2E Anand Shared").locator("[data-plan-closed]")).toHaveCount(0);
    await page.context().close();
  });

  test("header numbers and worst-first order cover the PM's scoped rows", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);

    // On plan: Anand Main, Anand Shared, Bhuj Neet, Vapi Closed. Out of 9 rows, Bhuj Setup and
    // Surat CET don't count: 4/7. PCM: Anand Shared 1 + Anand Main 1 + Vapi Closed 1 (both JEE
    // Main); PCB: Anand Shared 4 + Bhuj Neet 0 (NEET).
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("4/7");
    await expectChaptersBehind(page, "3", "4");
    await expect(page.getByText("Chapters behind", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-summary-row]")).toHaveCount(9);
    // By the larger of PCM and PCB Behind: Anand Shared 4; Vapi Closed and Anand Main are both
    // 1 behind and Vapi Closed has more tests overdue (2 vs 1); Bhuj Neet 0.
    expect(await rowCentres(page)).toEqual([
      "Summary E2E Anand Shared",
      "Summary E2E Vapi Closed",
      "Summary E2E Anand Main",
      "Summary E2E Bhuj Neet",
      "Summary E2E Surat Draft",
      "Summary E2E Vapi Unassigned",
      "Summary E2E Bhuj Setup",
      "Summary E2E Surat CET",
      "Summary E2E Navsari One",
    ]);
    await page.context().close();
  });
  test("the Grade toggle switches to Grade 12 rows and keeps the as-of date", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);
    await expect(page.getByRole("link", { name: "Grade 11" })).toHaveAttribute("aria-current", "page");

    await page.getByRole("link", { name: "Grade 12" }).click();
    await expect(page).toHaveURL(/grade=12/);
    await expect(page).toHaveURL(new RegExp(`as_of=${AS_OF}`));
    // Only Anand Main runs Grade 12 in the PM's scope: Limits done 2 Jul, Vectors (1 Aug) open.
    await expect(page.locator("[data-summary-row]")).toHaveCount(1);
    await expect(pill(page, "Summary E2E Anand Main", "Maths")).toHaveText("1 behind · 1/2");
    await expect(pill(page, "Summary E2E Anand Main", "Physics")).toHaveText("—");
    await expect(summaryRow(page, "Summary E2E Anand Main").locator("[data-plan]")).toHaveText(
      "Summary G12 Active Plan"
    );
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("1/1");
    await expectChaptersBehind(page, "1", "0");
    await expectGroup(page, "Summary E2E Anand Main", "PCM", "1 behind", "amber");
    await expectGroup(page, "Summary E2E Anand Main", "PCB", "—");
    // No Grade 12 chapter-test sessions: Limits (test date 2 Jul) and Vectors (2 Aug) overdue.
    await expect(page.getByTestId("summary-tests-overdue")).toHaveText("2");
    await page.context().close();
  });

  test("PM scope hides out-of-scope Centres that an Admin sees", async ({ browser, adminPage }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);
    await expect(summaryRow(page, "Summary E2E Anand Shared")).toHaveCount(1);
    await expect(summaryRow(page, "Summary E2E Other Region")).toHaveCount(0);
    await page.context().close();

    await adminPage.goto(`/curriculum-summary?as_of=${AS_OF}&limit=50`);
    await expect(summaryRow(adminPage, "Summary E2E Other Region").locator("[data-plan]")).toHaveText("No plan");
  });

  test("Admin rows paginate while the header numbers cover every row", async ({ adminPage }) => {
    // Admin Grade 11 = the PM's 9 rows + Other Region (No plan), LMS Empty School CoE Centre
    // (single JEE Main, No plan) and the LMS fixture CoE / Nodal Centres (JEE Main + JEE
    // Advanced setup errors): 13 rows, on plan 4 of 13 − 4 = 9.
    await adminPage.goto(`/curriculum-summary?as_of=${AS_OF}&limit=10`);
    await expect(adminPage.getByTestId("summary-centres-on-plan")).toHaveText("4/9");
    await expectChaptersBehind(adminPage, "3", "4");
    await expect(adminPage.locator("[data-summary-row]")).toHaveCount(10);
    await expect(adminPage.getByText("Page 1 of 2")).toBeVisible();

    await adminPage.getByRole("link", { name: "Next" }).click();
    await expect(adminPage.getByText("Page 2 of 2")).toBeVisible();
    await expect(adminPage.getByTestId("summary-centres-on-plan")).toHaveText("4/9");
    // The Admin-only rows have no plan, so they add no tests overdue to the PM's 8.
    await expect(adminPage.getByTestId("summary-tests-overdue")).toHaveText("8");
    expect(await rowCentres(adminPage)).toEqual([
      "Summary E2E Bhuj Setup",
      "Summary E2E Surat CET",
      "Summary E2E Navsari One",
    ]);
  });

  test("the old table, filters and stat cards are gone and removed params are ignored", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(
      `/curriculum-summary?as_of=${AS_OF}&programs=2&subjects=4&exam_tracks=neet&preset=all&flagged=true&sort=school&dir=asc`
    );
    await expect(page.locator("[data-summary-row]")).toHaveCount(9);
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("4/7");
    for (const removed of ["Flagged Rows", "Avg Completion", "Actual Hours", "Filters"]) {
      await expect(page.getByText(removed, { exact: true })).toHaveCount(0);
    }
    for (const label of ["Program", "Subject", "Exam Track", "From", "To"]) {
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /Show chapters for/ })).toHaveCount(0);

    // Rows link to the chapter timeline for the same Grade and as-of date.
    await expect(page.getByRole("link", { name: "Summary E2E Anand Shared" })).toHaveAttribute(
      "href",
      `/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`
    );
    await page.context().close();
  });

  test("an invalid as-of date falls back to today in IST", async ({ browser }) => {
    const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const page = await summaryPmPage(browser);
    for (const asOf of ["2026-02-30", "0999-06-01", "9999-06-01"]) {
      await page.goto(`/curriculum-summary?as_of=${asOf}`);
      await expect(page.getByLabel("As of")).toHaveValue(todayIst);
    }
    await page.context().close();
  });
});

// #427: Region, School search and Only behind narrow the rows; header numbers ignore Only behind.
test.describe("Curriculum Summary filters", () => {
  test("Region shows only rows in the chosen region and cannot widen a PM's scope", async ({
    browser,
    adminPage,
  }) => {
    await adminPage.goto(`/curriculum-summary?as_of=${AS_OF}&regions=SUMMARY_E2E_OTHER`);
    expect(await rowCentres(adminPage)).toEqual(["Summary E2E Other Region"]);
    await expect(adminPage.getByTestId("summary-centres-on-plan")).toHaveText("0/1");
    await expectChaptersBehind(adminPage, "0", "0");

    // The PM's 9 SUMMARY_E2E rows; the out-of-scope region in the URL adds nothing.
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}&regions=SUMMARY_E2E,SUMMARY_E2E_OTHER`);
    await expect(page.locator("[data-summary-row]")).toHaveCount(9);
    await expect(summaryRow(page, "Summary E2E Other Region")).toHaveCount(0);
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("4/7");

    await page.goto(`/curriculum-summary?as_of=${AS_OF}&regions=SUMMARY_E2E_OTHER`);
    await expect(page.locator("[data-summary-row]")).toHaveCount(0);
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("0/0");
    // Region choices are limited to the PM's scope.
    await page.locator("summary", { hasText: "Region" }).click();
    await expect(page.getByRole("checkbox", { name: "SUMMARY_E2E", exact: true })).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: "SUMMARY_E2E_OTHER", exact: true })).toHaveCount(0);
    await page.context().close();
  });

  test("School search matches School name or code", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    // "Summary Bhuj School": Bhuj Neet (on plan, 0 behind) and Bhuj Setup (not counted).
    await page.goto(`/curriculum-summary?as_of=${AS_OF}&q=bhuj`);
    expect(await rowCentres(page)).toEqual(["Summary E2E Bhuj Neet", "Summary E2E Bhuj Setup"]);
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("1/1");
    await expectChaptersBehind(page, "0", "0");

    // School code SUMM85 (Vapi): Vapi Closed (PCM 1 behind) and Vapi Unassigned (No plan).
    await page.goto(`/curriculum-summary?as_of=${AS_OF}&q=summ85`);
    expect(await rowCentres(page)).toEqual(["Summary E2E Vapi Closed", "Summary E2E Vapi Unassigned"]);
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("1/2");
    await expectChaptersBehind(page, "1", "0");
    await page.context().close();
  });

  test("Only behind hides on-track, No plan and error rows but keeps the header numbers", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}&only_behind=1`);
    // PCM or PCB Behind ≥ 1: Anand Shared (PCM 1, PCB 4), Vapi Closed PCM 1 (2 tests overdue),
    // Anand Main PCM 1 (1 test overdue). Bhuj Neet (PCB 0), the No plan rows and the setup /
    // no-content / configuration-error rows are hidden.
    expect(await rowCentres(page)).toEqual([
      "Summary E2E Anand Shared",
      "Summary E2E Vapi Closed",
      "Summary E2E Anand Main",
    ]);
    // Same as the unfiltered page: on plan 4 of 7, PCM 3 and PCB 4 chapters behind, 8 tests
    // overdue (Bhuj Neet's 3 still count).
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("4/7");
    await expectChaptersBehind(page, "3", "4");
    await expect(page.getByTestId("summary-tests-overdue")).toHaveText("8");
    await page.context().close();
  });

  test("filters apply from the filter bar, reset to page 1 and survive a reload", async ({ adminPage }) => {
    await adminPage.goto(`/curriculum-summary?as_of=${AS_OF}&limit=10&page=2`);
    await expect(adminPage.getByText("Page 2 of 2")).toBeVisible();

    await adminPage.locator("summary", { hasText: "Region" }).click();
    await adminPage.getByRole("checkbox", { name: "SUMMARY_E2E", exact: true }).check();
    await adminPage.getByRole("searchbox", { name: "School" }).fill("anand");
    await adminPage.getByRole("checkbox", { name: "Only behind" }).check();
    await adminPage.getByRole("button", { name: "Apply" }).click();

    await expect(adminPage).toHaveURL(/only_behind=1/);
    const url = new URL(adminPage.url());
    expect(url.searchParams.getAll("regions")).toEqual(["SUMMARY_E2E"]);
    expect(url.searchParams.get("q")).toBe("anand");
    expect(url.searchParams.get("as_of")).toBe(AS_OF);
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("page")).toBeNull();

    // Anand School in SUMMARY_E2E: Anand Shared (PCM 1, PCB 4) and Anand Main (PCM 1).
    const expectAnandRows = async () => {
      await expect(adminPage.getByText("Page 1 of 1")).toBeVisible();
      expect(await rowCentres(adminPage)).toEqual(["Summary E2E Anand Shared", "Summary E2E Anand Main"]);
      await expect(adminPage.getByTestId("summary-centres-on-plan")).toHaveText("2/2");
      await expectChaptersBehind(adminPage, "2", "4");
      // Anand Shared 2 + Anand Main 1.
      await expect(adminPage.getByTestId("summary-tests-overdue")).toHaveText("3");
    };
    await expectAnandRows();

    await adminPage.reload();
    await expectAnandRows();
    await expect(adminPage.getByRole("searchbox", { name: "School" })).toHaveValue("anand");
    await expect(adminPage.getByRole("checkbox", { name: "Only behind" })).toBeChecked();
    await adminPage.locator("summary", { hasText: "Region" }).click();
    await expect(adminPage.getByRole("checkbox", { name: "SUMMARY_E2E", exact: true })).toBeChecked();

    // The Grade toggle keeps every filter: only Anand Main runs Grade 12 (PCM 1 behind).
    await adminPage.getByRole("link", { name: "Grade 12" }).click();
    await expect(adminPage).toHaveURL(/grade=12/);
    const gradeUrl = new URL(adminPage.url());
    expect(gradeUrl.searchParams.getAll("regions")).toEqual(["SUMMARY_E2E"]);
    expect(gradeUrl.searchParams.get("q")).toBe("anand");
    expect(gradeUrl.searchParams.get("only_behind")).toBe("1");
    expect(await rowCentres(adminPage)).toEqual(["Summary E2E Anand Main"]);
  });
});

// #428: Chapter Test Status from new-CMS chapter-test quiz sessions. Fixture:
// e2e/fixtures/migrations/20261019140000_seed_curriculum_summary_chapter_tests.sql. A Chapter
// Test is Overdue when no session counts for it and as-of is more than 7 days after its test
// date (plan test date, else due + 1). Bio Animals has a plan test date of 5 Aug.
test.describe("Curriculum Summary Chapter tests overdue", () => {
  test("Tests overdue per row and in the header follow the counted sessions", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);

    // Anand Shared: Alpha ended 2 Jul (test id in cms_source_id); Beta is scheduled for 20 Aug
    // (majority of its test's problems); Chem Bonding ended 20 Jul (code in the session name);
    // Bio Cells ended 20 Jun (test linked to the duplicate Cells row). Bio Plants has only
    // inactive / failed / combined / legacy-CMS / last-year sessions, and Bio Animals (test date
    // 5 Aug) none: 2 overdue. Genetics (test date 13 Aug) and Thermo are not due yet.
    await expect(summaryRow(page, "Summary E2E Anand Shared").locator("[data-tests-overdue]")).toHaveText("2");
    // Anand Main: the two-Centre Alpha session ended 5 Jul; Beta (test date 1 Aug) overdue: 1.
    await expect(summaryRow(page, "Summary E2E Anand Main").locator("[data-tests-overdue]")).toHaveText("1");
    // Bhuj Neet: the same two-Centre session covers Alpha; Chem Bonding started with no end time
    // (Scheduled); Bio Cells, Plants and Animals overdue: 3.
    await expect(summaryRow(page, "Summary E2E Bhuj Neet").locator("[data-tests-overdue]")).toHaveText("3");
    // Vapi Closed: no sessions; Alpha (test date 1 Jul) and Beta (21 Jul) overdue: 2.
    await expect(summaryRow(page, "Summary E2E Vapi Closed").locator("[data-tests-overdue]")).toHaveText("2");
    // 2 + 1 + 3 + 2.
    await expect(page.getByTestId("summary-tests-overdue")).toHaveText("8");

    // Setup-error rows show no test number.
    await expect(summaryRow(page, "Summary E2E Bhuj Setup").locator("[data-tests-overdue]")).toHaveCount(0);
    await expect(summaryRow(page, "Summary E2E Bhuj Setup").locator("[data-tests-conducted]")).toHaveCount(0);
    await page.context().close();
  });

  test("No plan rows show Conducted Chapter Tests and add nothing to the header", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);

    // Surat Draft: Alpha ends at 23:30 on the as-of day (Conducted); the Majority test is on 20 Aug.
    const draft = summaryRow(page, "Summary E2E Surat Draft");
    await expect(draft.locator("[data-tests-conducted]")).toHaveText("1 conducted");
    await expect(draft.locator("[data-tests-overdue]")).toHaveCount(0);
    await expect(summaryRow(page, "Summary E2E Vapi Unassigned").locator("[data-tests-conducted]")).toHaveText(
      "0 conducted"
    );
    // School search for Surat: the Draft row only, so no overdue tests.
    await page.goto(`/curriculum-summary?as_of=${AS_OF}&q=surat`);
    await expect(page.getByTestId("summary-tests-overdue")).toHaveText("0");

    // A day earlier the Surat Alpha session hasn't ended yet.
    await page.goto("/curriculum-summary?as_of=2026-08-14");
    await expect(summaryRow(page, "Summary E2E Surat Draft").locator("[data-tests-conducted]")).toHaveText(
      "0 conducted"
    );
    await page.context().close();
  });

  test("an earlier as-of date has fewer overdue tests", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    // On 9 Aug: Vapi Closed Alpha (test date 1 Jul) and Beta (21 Jul) overdue; Anand Main Beta
    // (test date 1 Aug) is on day 8 of the grace period, so overdue; Bhuj Neet Cells and Plants
    // overdue, Animals (test date 5 Aug) only on day 4; Anand Shared only Plants.
    await page.goto("/curriculum-summary?as_of=2026-08-09");
    await expect(summaryRow(page, "Summary E2E Anand Shared").locator("[data-tests-overdue]")).toHaveText("1");
    await expect(summaryRow(page, "Summary E2E Anand Main").locator("[data-tests-overdue]")).toHaveText("1");
    await expect(summaryRow(page, "Summary E2E Bhuj Neet").locator("[data-tests-overdue]")).toHaveText("2");
    await expect(summaryRow(page, "Summary E2E Vapi Closed").locator("[data-tests-overdue]")).toHaveText("2");
    await expect(page.getByTestId("summary-tests-overdue")).toHaveText("6");
    await page.context().close();
  });
});

// Fixture: e2e/fixtures/migrations/20261019170000_seed_curriculum_summary_as_of_fixture.sql. A
// session counts for an as-of date only if it is in that date's academic year and was created
// or had started by the end of that day.
test.describe("Curriculum Summary Chapter Test Status as of a past date", () => {
  test("a session from the next academic year never counts", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    // Anand Shared's only countable Bio Plants session is on 10 Jul 2027, next academic year:
    // viewed today, 1 Feb 2027 still shows the test Overdue rather than Scheduled.
    await page.goto("/curriculum-summary/centres/9000812?grade=11&as_of=2027-02-01");
    await expect(timelineRow(page, "Summary Bio Plants").locator("[data-test-status]")).toHaveText("Overdue");
    await page.context().close();
  });

  test("a session created after the as-of date does not count for it", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    // The Bio Animals session for 25 Aug was created on 18 Aug.
    for (const [asOf, testStatus] of [
      ["2026-08-17", "Overdue"],
      ["2026-08-18", "Scheduled"],
    ] as const) {
      await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${asOf}`);
      await expect(timelineRow(page, "Summary Bio Animals").locator("[data-test-status]")).toHaveText(testStatus);
    }
    await page.context().close();
  });

  test("the majority fallback counts duplicate Chapter rows as one Chapter", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    // Bhuj Neet's 17 Aug test has problems Alpha ×2, Bio Cells ×2 and duplicate Bio Cells ×1: it
    // is a Bio Cells test. Alpha keeps its earlier 5 Jul session.
    await page.goto("/curriculum-summary/centres/9000821?grade=11&as_of=2026-08-20");
    await expect(timelineRow(page, "Summary Bio Cells").locator("[data-test-status]")).toHaveText(
      "Conducted 17 Aug 2026"
    );
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-test-status]")).toHaveText(
      "Conducted 5 Jul 2026"
    );
    await page.context().close();
  });
});

// #429: the chapter timeline for one Summary Class at /curriculum-summary/centres/[id]. Every
// status, date and count below is worked out by hand from the Summary and Chapter Test fixtures
// with as_of pinned.
function timelineRow(page: Page, chapter: string) {
  return page.locator(`[data-timeline-row][data-chapter="${chapter}"]`);
}

test.describe("Curriculum Summary chapter timeline", () => {
  test("clicking a Summary row opens the class's timeline for the same Grade and as-of date", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary?as_of=${AS_OF}`);
    await page.getByRole("link", { name: "Summary E2E Anand Shared" }).click();

    await expect(page).toHaveURL(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);
    await expect(page.getByRole("heading", { name: "Summary E2E Anand Shared" })).toBeVisible();
    // Bio Plants was due 10 Jul and its only completion is 01:30 IST on 16 Aug, after as-of.
    await expect(timelineRow(page, "Summary Bio Plants").locator("[data-status]")).toHaveText("Overdue 36 days");
    await page.context().close();
  });

  test("each Chapter shows its status and earliest in-window completion date (IST)", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);

    // [Chapter, status, completion date] for Anand Shared (JEE Main + NEET) on 15 Aug.
    const expected: [string, string, string][] = [
      ["Summary Bio Cells", "Done", "10 Jun 2026"],
      // Completed under JEE Main (25 Jun) and NEET (28 Jun): one row, the earlier date.
      ["Fixture Alpha Physics", "Done", "25 Jun 2026"],
      ["Summary Bio Plants", "Overdue 36 days", "—"],
      ["Summary Chem Bonding", "Overdue 31 days", "—"],
      // A JEE Main Chapter completed only under the class's NEET track.
      ["Fixture Beta Physics", "Done", "25 Jul 2026"],
      ["Summary Bio Animals", "Overdue 5 days", "—"],
      ["Summary Bio Genetics", "Overdue 3 days", "—"],
      // Completed 1 Aug, ahead of its 30 Sep due date.
      ["Summary Chem Thermo", "Done", "1 Aug 2026"],
    ];
    for (const [chapter, status, completedOn] of expected) {
      await expect(timelineRow(page, chapter)).toHaveCount(1);
      await expect(timelineRow(page, chapter).locator("[data-status]")).toHaveText(status);
      await expect(timelineRow(page, chapter).locator("[data-completed-on]")).toHaveText(completedOn);
    }

    // Plants' completion at 01:30 IST on 16 Aug (20:00 UTC on 15 Aug) counts from 16 Aug.
    await page.goto("/curriculum-summary/centres/9000812?grade=11&as_of=2026-08-20");
    await expect(timelineRow(page, "Summary Bio Plants").locator("[data-status]")).toHaveText("Done 37 days late");
    await expect(timelineRow(page, "Summary Bio Plants").locator("[data-completed-on]")).toHaveText("16 Aug 2026");

    // Bhuj Neet: Alpha due 30 Jun, completed 5 Jul.
    await page.goto(`/curriculum-summary/centres/9000821?grade=11&as_of=${AS_OF}`);
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-status]")).toHaveText("Done 5 days late");
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-completed-on]")).toHaveText("5 Jul 2026");

    // Anand Main: Beta's only completion (20 Mar 2026) is in the previous academic year.
    await page.goto(`/curriculum-summary/centres/9000811?grade=11&as_of=${AS_OF}`);
    await expect(timelineRow(page, "Fixture Beta Physics").locator("[data-status]")).toHaveText("Overdue 15 days");
    await expect(timelineRow(page, "Fixture Beta Physics").locator("[data-completed-on]")).toHaveText("—");

    // Surat Draft has only a Draft plan: no Chapter is in a plan.
    await page.goto(`/curriculum-summary/centres/9000832?grade=11&as_of=${AS_OF}`);
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-status]")).toHaveText("Not in plan");
    await expect(timelineRow(page, "Fixture Beta Physics").locator("[data-status]")).toHaveText("Not in plan");
    await expect(page.locator("[data-timeline-plan]")).toHaveText("No plan");
    await page.context().close();
  });

  test("each Chapter shows its Chapter Test Status from the counted sessions", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);

    // Anand Shared on 15 Aug. Plants has only never-counting sessions and Animals (test date
    // 5 Aug) none, both more than 7 days past their test dates; Genetics' test date is 13 Aug.
    const expected: [string, string][] = [
      ["Fixture Alpha Physics", "Conducted 2 Jul 2026"],
      ["Fixture Beta Physics", "Scheduled"],
      ["Summary Chem Bonding", "Conducted 20 Jul 2026"],
      ["Summary Bio Cells", "Conducted 20 Jun 2026"],
      ["Summary Bio Plants", "Overdue"],
      ["Summary Bio Animals", "Overdue"],
      ["Summary Bio Genetics", "Not due"],
      ["Summary Chem Thermo", "Not due"],
    ];
    for (const [chapter, testStatus] of expected) {
      await expect(timelineRow(page, chapter).locator("[data-test-status]")).toHaveText(testStatus);
    }

    // Bhuj Neet: the Bonding session has started but has no end time.
    await page.goto(`/curriculum-summary/centres/9000821?grade=11&as_of=${AS_OF}`);
    await expect(timelineRow(page, "Summary Chem Bonding").locator("[data-test-status]")).toHaveText("Scheduled");

    // Surat Draft has no plan, but its test statuses still show: Alpha ended 23:30 on the as-of
    // day; the Majority (Beta) test is on 20 Aug.
    await page.goto(`/curriculum-summary/centres/9000832?grade=11&as_of=${AS_OF}`);
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-test-status]")).toHaveText(
      "Conducted 15 Aug 2026"
    );
    await expect(timelineRow(page, "Fixture Beta Physics").locator("[data-test-status]")).toHaveText("Scheduled");
    await page.context().close();
  });

  test("Chapters run in due-date order with the as-of marker between due and not-yet-due rows", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);

    const order = await page
      .locator("[data-timeline-row], [data-as-of-marker]")
      .evaluateAll((rows) =>
        rows.map((row) => (row.hasAttribute("data-as-of-marker") ? "AS OF" : row.getAttribute("data-chapter")))
      );
    // Dated rows by due date; the timeline fixture's undated Chem Organic (sequence 3) and Bio
    // Ecology (sequence 5) come last, Chemistry before Biology.
    expect(order).toEqual([
      "Summary Bio Cells",
      "Fixture Alpha Physics",
      "Summary Bio Plants",
      "Summary Chem Bonding",
      "Fixture Beta Physics",
      "Summary Bio Animals",
      "Summary Bio Genetics",
      "AS OF",
      "Summary Chem Thermo",
      "Summary Chem Organic",
      "Summary Bio Ecology",
    ]);
    await expect(page.locator("[data-as-of-marker]")).toContainText("As of 15 Aug 2026");
    await expect(timelineRow(page, "Summary Chem Organic").locator("[data-status]")).toHaveText("Not in plan");
    await expect(timelineRow(page, "Summary Bio Ecology").locator("[data-test-status]")).toHaveText("Not due");
    await page.context().close();
  });

  test("the header counts the class and subject tabs carry the Summary pills", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);

    // Due: Cells, Alpha, Plants, Bonding, Beta, Animals, Genetics; done: Cells, Alpha, Beta.
    await expect(page.getByTestId("timeline-due-done")).toHaveText("3/7");
    // Completed in window: Cells, Alpha, Beta, Thermo of the class's 10 in-syllabus Chapters.
    await expect(page.getByTestId("timeline-syllabus-done")).toHaveText("4/10");
    await expect(page.getByTestId("timeline-tests-overdue")).toHaveText("2");

    // Same text as the Anand Shared Summary pills; no Maths content, so no Maths tab.
    await expect(page.locator("[data-subject-tab]")).toHaveText([/^All$/, /^Physics/, /^Chemistry/, /^Biology/]);
    await expect(page.locator('[data-subject-tab="Physics"] [data-tab-progress]')).toHaveText("On track · 2/2");
    await expect(page.locator('[data-subject-tab="Chemistry"] [data-tab-progress]')).toHaveText("1 behind · 0/1");
    await expect(page.locator('[data-subject-tab="Biology"] [data-tab-progress]')).toHaveText("3 behind · 1/4");
    await expect(page.locator('[data-subject-tab="All"]')).toHaveAttribute("aria-current", "page");

    await page.locator('[data-subject-tab="Biology"]').click();
    await expect(page).toHaveURL(/subject=Biology/);
    await expect(page).toHaveURL(new RegExp(`as_of=${AS_OF}`));
    await expect(page.locator('[data-subject-tab="Biology"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-timeline-row]")).toHaveText([
      /Summary Bio Cells/,
      /Summary Bio Plants/,
      /Summary Bio Animals/,
      /Summary Bio Genetics/,
      /Summary Bio Ecology/,
    ]);
    // The header still covers the whole class.
    await expect(page.getByTestId("timeline-due-done")).toHaveText("3/7");
    await page.context().close();
  });

  test("a PM opening a Centre outside their Summary rows gets not found with no data", async ({
    browser,
    adminPage,
  }) => {
    const page = await summaryPmPage(browser);
    // Other Region is outside the PM's region; Navsari Two maps no Exam Track; Anand Shared runs
    // no Grade 12 class.
    for (const path of [
      `/curriculum-summary/centres/9000841?grade=11&as_of=${AS_OF}`,
      `/curriculum-summary/centres/9000862?grade=11&as_of=${AS_OF}`,
      `/curriculum-summary/centres/9000812?grade=12&as_of=${AS_OF}`,
      `/curriculum-summary/centres/not-a-centre?grade=11&as_of=${AS_OF}`,
    ]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(page.locator("[data-timeline-row]")).toHaveCount(0);
      await expect(page.getByText(/Summary E2E/)).toHaveCount(0);
    }
    await page.context().close();

    await adminPage.goto(`/curriculum-summary/centres/9000841?grade=11&as_of=${AS_OF}`);
    await expect(adminPage.getByRole("heading", { name: "Summary E2E Other Region" })).toBeVisible();
    await expect(adminPage.locator("[data-timeline-plan]")).toHaveText("No plan");
  });

  test("every viewer sees the plan name and Closed label; only Admins get a link to the plan", async ({
    browser,
    adminPage,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);
    await expect(page.locator("[data-timeline-plan]")).toHaveText("Summary G11 Active Plan");
    await expect(page.getByRole("link", { name: "Summary G11 Active Plan" })).toHaveCount(0);
    await expect(page.locator("[data-timeline-plan-closed]")).toHaveCount(0);

    // Closed 31 Jul: Alpha completed 5 Aug against its 30 Jun due date still counts.
    await page.goto(`/curriculum-summary/centres/9000852?grade=11&as_of=${AS_OF}`);
    await expect(page.locator("[data-timeline-plan]")).toHaveText("Summary G11 Closed Plan");
    await expect(page.locator("[data-timeline-plan-closed]")).toHaveText("Closed");
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-status]")).toHaveText("Done 36 days late");
    await expect(timelineRow(page, "Fixture Beta Physics").locator("[data-status]")).toHaveText("Overdue 26 days");
    await page.context().close();

    await adminPage.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);
    await expect(adminPage.getByRole("link", { name: "Summary G11 Active Plan" })).toHaveAttribute(
      "href",
      "/curriculum-summary/plans/900001"
    );
  });

  test("the Grade toggle and As of date reload the timeline; an invalid as-of falls back to today", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000811?grade=11&as_of=${AS_OF}`);
    await expect(page.getByRole("link", { name: "Grade 11" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("As of")).toHaveValue(AS_OF);

    await page.getByRole("link", { name: "Grade 12" }).click();
    await expect(page).toHaveURL(`/curriculum-summary/centres/9000811?grade=12&as_of=${AS_OF}`);
    await expect(page.locator("[data-timeline-plan]")).toHaveText("Summary G12 Active Plan");
    // Limits due 1 Jul, completed 2 Jul; Vectors due 1 Aug, open.
    await expect(timelineRow(page, "Summary Maths Limits").locator("[data-status]")).toHaveText("Done 1 day late");
    await expect(timelineRow(page, "Summary Maths Limits").locator("[data-completed-on]")).toHaveText("2 Jul 2026");
    await expect(timelineRow(page, "Summary Maths Vectors").locator("[data-status]")).toHaveText("Overdue 14 days");

    // On 1 Aug Vectors is due that day: Overdue 0 days.
    await page.getByLabel("As of").fill("2026-08-01");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/grade=12/);
    await expect(page).toHaveURL(/as_of=2026-08-01/);
    await expect(timelineRow(page, "Summary Maths Vectors").locator("[data-status]")).toHaveText("Overdue 0 days");

    const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    await page.goto("/curriculum-summary/centres/9000811?grade=12&as_of=2026-02-30");
    await expect(page.getByLabel("As of")).toHaveValue(todayIst);
    // Years outside the supported range fall back to today too instead of failing.
    for (const asOf of ["0999-06-01", "9999-06-01"]) {
      await page.goto(`/curriculum-summary/centres/9000811?grade=12&as_of=${asOf}`);
      await expect(page.getByLabel("As of")).toHaveValue(todayIst);
    }
    await page.context().close();
  });

  test("a Grade the Centre has no class for is shown but not linked", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    // Anand Shared runs only Grade 11, so its Grade 12 timeline does not exist.
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}&hours=7d`);
    const grades = page.getByRole("navigation", { name: "Grade" });
    await expect(grades.getByRole("link", { name: "Grade 11" })).toHaveAttribute("aria-current", "page");
    await expect(grades.getByRole("link", { name: "Grade 12" })).toHaveCount(0);
    await expect(grades.getByText("Grade 12")).toHaveAttribute("aria-disabled", "true");
    await page.context().close();
  });

  test("setup-error, no-content and ambiguous-Centre classes show the Summary's message instead of metrics", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    for (const [centreId, message] of [
      ["9000822", "Fix tracks in Centre Management"],
      ["9000831", "Curriculum configuration is unavailable"],
      ["9000861", "Multiple active physical Centres are configured for this School and Program"],
    ]) {
      await page.goto(`/curriculum-summary/centres/${centreId}?grade=11&as_of=${AS_OF}`);
      await expect(page.getByTestId("timeline-explanation")).toHaveText(message);
      await expect(page.locator("[data-timeline-row]")).toHaveCount(0);
      await expect(page.getByTestId("timeline-due-done")).toHaveCount(0);
      await expect(page.locator("[data-subject-tab]")).toHaveCount(0);
    }
    await page.context().close();
  });
});

// #430: hours taught against the Primary Exam Track's prescribed time, class cancellations and
// doubt solving on the chapter timeline. Fixture:
// e2e/fixtures/migrations/20261019160000_seed_curriculum_timeline_hours_fixture.sql. Windows end
// at as-of 15 Aug: This AY = 1 Apr–15 Aug, Last 30 days = 17 Jul–15 Aug, Last 7 days = 9–15 Aug.
test.describe("Curriculum Summary chapter timeline hours", () => {
  test("hours split to Chapters by topic share and sum both tracks of a shared class per window", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    const base = `/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`;

    // [hours param, Alpha, Bio Cells, Bio Plants, Beta, header]. Alpha: 120 min under JEE Main on
    // 1 Aug + 60 min under NEET on 10 Jun. The 90 min log on 12 Aug covers two Cells topics and
    // one Plants topic. Last-year, after-as-of, deleted and JEE Advanced logs never count.
    const expected: [string, string, string, string, string, string][] = [
      ["", "3h", "1h", "30m", "0h", "4h 30m"],
      ["&hours=ay", "3h", "1h", "30m", "0h", "4h 30m"],
      ["&hours=30d", "2h", "1h", "30m", "0h", "3h 30m"],
      ["&hours=7d", "0h", "1h", "30m", "0h", "1h 30m"],
    ];
    for (const [hours, alpha, cells, plants, beta, header] of expected) {
      await page.goto(`${base}${hours}`);
      await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-hours]")).toHaveText(alpha);
      await expect(timelineRow(page, "Summary Bio Cells").locator("[data-hours]")).toHaveText(cells);
      await expect(timelineRow(page, "Summary Bio Plants").locator("[data-hours]")).toHaveText(plants);
      await expect(timelineRow(page, "Fixture Beta Physics").locator("[data-hours]")).toHaveText(beta);
      // Prescribed: Alpha 1h 30m, Beta 2h and eight NEET-only Chapters at 1h each = 11h 30m.
      await expect(page.getByTestId("timeline-hours")).toHaveText(`${header} / 11h 30m`);
    }
    await page.context().close();
  });

  test("a shared class's prescribed time is JEE Main's, falling back to NEET for Biology", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);
    // Alpha: JEE Main 90 min, not NEET's 60. Beta: JEE Main 120. Biology has no JEE Main config.
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-prescribed]")).toHaveText("1h 30m");
    await expect(timelineRow(page, "Fixture Beta Physics").locator("[data-prescribed]")).toHaveText("2h");
    await expect(timelineRow(page, "Summary Bio Cells").locator("[data-prescribed]")).toHaveText("1h");
    await page.context().close();
  });

  test("class cancellations and doubt solving show per Chapter and in the header without changing status", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);

    // This AY. Alpha: cancelled 20 Jul (JEE Main) and 5 May (NEET); doubt solving 30 min on
    // 25 Jul and 60 min on 1 Apr (the 31 Mar log is last academic year). Plants: cancelled 13 Aug
    // (the 14 Aug cancellation is deleted). Cells: 45 min doubt solving on 14 Aug.
    const expected: [string, string, string][] = [
      ["Fixture Alpha Physics", "2", "1h 30m"],
      ["Summary Bio Plants", "1", "0h"],
      ["Summary Bio Cells", "0", "45m"],
      ["Fixture Beta Physics", "0", "0h"],
    ];
    for (const [chapter, cancellations, doubtSolving] of expected) {
      await expect(timelineRow(page, chapter).locator("[data-cancellations]")).toHaveText(cancellations);
      await expect(timelineRow(page, chapter).locator("[data-doubt-solving]")).toHaveText(doubtSolving);
    }
    await expect(page.getByTestId("timeline-cancellations")).toHaveText("3");
    await expect(page.getByTestId("timeline-doubt-solving")).toHaveText("2h 15m");

    // Plants was cancelled and is still Overdue; Alpha had doubt solving and is still Done.
    await expect(timelineRow(page, "Summary Bio Plants").locator("[data-status]")).toHaveText("Overdue 36 days");
    await expect(timelineRow(page, "Fixture Alpha Physics").locator("[data-status]")).toHaveText("Done");
    await expect(page.getByTestId("timeline-due-done")).toHaveText("3/7");
    await page.context().close();
  });

  test("switching the hours window updates hours, cancellations and doubt solving but not status", async ({
    browser,
  }) => {
    const page = await summaryPmPage(browser);
    await page.goto(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);
    const window = page.getByRole("navigation", { name: "Hours window" });
    await expect(window.getByRole("link", { name: "This AY" })).toHaveAttribute("aria-current", "page");

    // [window, header hours, cancelled, doubt solving, Alpha hours, Alpha cancelled, Alpha doubt].
    const expected: [string, string, string, string, string, string, string, string][] = [
      ["Last 30 days", "30d", "3h 30m / 11h 30m", "2", "1h 15m", "2h", "1", "30m"],
      ["Last 7 days", "7d", "1h 30m / 11h 30m", "1", "45m", "0h", "0", "0h"],
      ["This AY", "", "4h 30m / 11h 30m", "3", "2h 15m", "3h", "2", "1h 30m"],
    ];
    for (const [label, param, hours, cancelled, doubt, alphaHours, alphaCancelled, alphaDoubt] of expected) {
      await window.getByRole("link", { name: label }).click();
      if (param) {
        await expect(page).toHaveURL(
          `/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}&hours=${param}`
        );
      } else {
        await expect(page).toHaveURL(`/curriculum-summary/centres/9000812?grade=11&as_of=${AS_OF}`);
      }
      await expect(window.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("timeline-hours")).toHaveText(hours);
      await expect(page.getByTestId("timeline-cancellations")).toHaveText(cancelled);
      await expect(page.getByTestId("timeline-doubt-solving")).toHaveText(doubt);
      const alpha = timelineRow(page, "Fixture Alpha Physics");
      await expect(alpha.locator("[data-hours]")).toHaveText(alphaHours);
      await expect(alpha.locator("[data-cancellations]")).toHaveText(alphaCancelled);
      await expect(alpha.locator("[data-doubt-solving]")).toHaveText(alphaDoubt);
      // Status columns and the header's Due done never depend on the window.
      await expect(alpha.locator("[data-status]")).toHaveText("Done");
      await expect(alpha.locator("[data-test-status]")).toHaveText("Conducted 2 Jul 2026");
      await expect(timelineRow(page, "Summary Bio Plants").locator("[data-status]")).toHaveText("Overdue 36 days");
      await expect(page.getByTestId("timeline-due-done")).toHaveText("3/7");
      await expect(page.getByTestId("timeline-tests-overdue")).toHaveText("2");
    }

    // The window stays in the URL through subject tabs, the As of form and the Grade toggle.
    await window.getByRole("link", { name: "Last 7 days" }).click();
    await expect(page).toHaveURL(/hours=7d/);
    await page.locator('[data-subject-tab="Biology"]').click();
    await expect(page).toHaveURL(/hours=7d/);
    await expect(page).toHaveURL(/subject=Biology/);
    await expect(page.getByTestId("timeline-hours")).toHaveText("1h 30m / 11h 30m");

    // On 20 Aug the last 7 days are 14–20 Aug: only the 16 Aug log (30 min of Cells).
    await page.getByLabel("As of").fill("2026-08-20");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/hours=7d/);
    await expect(page).toHaveURL(/as_of=2026-08-20/);
    await expect(page.getByTestId("timeline-hours")).toHaveText("30m / 11h 30m");

    await page.context().close();
  });

  test("logs under a duplicate Chapter row count toward the plan's Chapter", async ({ browser }) => {
    const page = await summaryPmPage(browser);
    // Last 7 days to 22 Aug = 16–22 Aug: the 16 Aug Cells log (30 min) and, under the duplicate
    // Bio Cells row on 21 Aug, 20 min taught, one cancellation and 15 min of doubt solving.
    await page.goto("/curriculum-summary/centres/9000812?grade=11&as_of=2026-08-22&hours=7d");
    const cells = timelineRow(page, "Summary Bio Cells");
    await expect(cells.locator("[data-hours]")).toHaveText("50m");
    await expect(cells.locator("[data-cancellations]")).toHaveText("1");
    await expect(cells.locator("[data-doubt-solving]")).toHaveText("15m");
    await expect(page.getByTestId("timeline-hours")).toHaveText("50m / 11h 30m");
    await page.context().close();
  });
});

// Grade 12 classes running one track each, seeded and removed here so no other spec counts
// them: a Chemistry Chapter prescribed 10h for JEE Main, 14h for JEE Advanced and 8h for NEET.
const PRIMARY_TRACK_CENTRES: [number, string, number, number, string][] = [
  [9000881, "Summary E2E Hours Main", 900088, 1, "jee_main"],
  [9000882, "Summary E2E Hours Advanced", 900088, 2, "jee_advanced"],
  [9000891, "Summary E2E Hours Neet", 900089, 1, "neet"],
];
const PRIMARY_TRACK_CHAPTER_ID = 90008801;

test.describe("Curriculum Summary chapter timeline prescribed time", () => {
  test.beforeAll(async () => {
    const pool = getTestPool();
    try {
      await pool.query(
        `INSERT INTO school
           (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
         VALUES
           (900088, 'SUMM88', 'Summary Hours School', NOW(), NOW(), '81000000088', 'JNV', 'SUMMARY_HOURS_E2E', 'Gujarat', 'Anand', ARRAY[1, 2]::integer[]),
           (900089, 'SUMM89', 'Summary Hours Neet School', NOW(), NOW(), '81000000089', 'JNV', 'SUMMARY_HOURS_E2E', 'Gujarat', 'Anand', ARRAY[1]::integer[])
         ON CONFLICT (id) DO NOTHING`
      );
      for (const [centreId, name, schoolId, programId, track] of PRIMARY_TRACK_CENTRES) {
        await pool.query(
          `INSERT INTO centres (id, name, school_id, is_physical, is_active, program_id)
           VALUES ($1, $2, $3, true, true, $4) ON CONFLICT (id) DO NOTHING`,
          [centreId, name, schoolId, programId]
        );
        await pool.query(
          `INSERT INTO centre_exam_tracks (centre_id, grade_id, exam_track_code)
           VALUES ($1, 4, $2) ON CONFLICT DO NOTHING`,
          [centreId, track]
        );
      }
      await pool.query(
        `INSERT INTO chapter (id, code, grade_id, subject_id, inserted_at, updated_at, name)
         VALUES ($1, 'SUM-HRS01', 4, 2, NOW(), NOW(), '[{"chapter":"Summary Chem Equilibrium","lang_code":"en"}]'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [PRIMARY_TRACK_CHAPTER_ID]
      );
      await pool.query(
        `INSERT INTO lms_chapter_exam_configs
           (chapter_id, exam_track, is_in_syllabus, prescribed_minutes, coverage_sequence, inserted_by_email, updated_by_email)
         VALUES
           ($1, 'jee_main', true, 600, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
           ($1, 'jee_advanced', true, 840, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org'),
           ($1, 'neet', true, 480, 1, 'e2e@avantifellows.org', 'e2e@avantifellows.org')
         ON CONFLICT (chapter_id, exam_track) DO NOTHING`,
        [PRIMARY_TRACK_CHAPTER_ID]
      );
    } finally {
      await pool.end();
    }
  });

  test.afterAll(async () => {
    const pool = getTestPool();
    const centreIds = PRIMARY_TRACK_CENTRES.map(([centreId]) => centreId);
    try {
      await pool.query("DELETE FROM lms_chapter_exam_configs WHERE chapter_id = $1", [PRIMARY_TRACK_CHAPTER_ID]);
      await pool.query("DELETE FROM chapter WHERE id = $1", [PRIMARY_TRACK_CHAPTER_ID]);
      await pool.query("DELETE FROM centre_exam_tracks WHERE centre_id = ANY($1::int[])", [centreIds]);
      await pool.query("DELETE FROM centres WHERE id = ANY($1::int[])", [centreIds]);
      await pool.query("DELETE FROM school WHERE id IN (900088, 900089)");
    } finally {
      await pool.end();
    }
  });

  test("each class's prescribed time follows its Primary Exam Track", async ({ adminPage }) => {
    for (const [centreId, prescribed] of [
      [9000881, "10h"],
      [9000882, "14h"],
      [9000891, "8h"],
    ] as const) {
      await adminPage.goto(`/curriculum-summary/centres/${centreId}?grade=12&as_of=${AS_OF}`);
      await expect(timelineRow(adminPage, "Summary Chem Equilibrium").locator("[data-prescribed]")).toHaveText(
        prescribed
      );
    }
  });
});
