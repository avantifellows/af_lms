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
    await expect(shared.locator("[data-behind]")).toHaveText("4");
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
    await expect(summaryRow(page, "Summary E2E Anand Shared").locator("[data-behind]")).toHaveText("3");

    // On 1 Jul only Alpha (30 Jun) and Bio Cells (15 Jun) were due, and both were done.
    await page.goto("/curriculum-summary?as_of=2026-07-01");
    await expect(pill(page, "Summary E2E Anand Shared", "Physics")).toHaveText("On track · 1/1");
    await expect(pill(page, "Summary E2E Anand Shared", "Chemistry")).toHaveText("On track · 0/0");
    await expect(pill(page, "Summary E2E Anand Shared", "Biology")).toHaveText("On track · 1/1");
    await expect(summaryRow(page, "Summary E2E Anand Shared").locator("[data-behind]")).toHaveText("0");
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
    // Surat CET don't count: 4/7. Behind: 1 + 4 + 0 + 1 = 6.
    await expect(page.getByTestId("summary-centres-on-plan")).toHaveText("4/7");
    await expect(page.getByTestId("summary-chapters-behind")).toHaveText("6");
    await expect(page.locator("[data-summary-row]")).toHaveCount(9);
    expect(await rowCentres(page)).toEqual([
      "Summary E2E Anand Shared",
      "Summary E2E Anand Main",
      "Summary E2E Vapi Closed",
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
    await expect(page.getByTestId("summary-chapters-behind")).toHaveText("1");
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
    await expect(adminPage.getByTestId("summary-chapters-behind")).toHaveText("6");
    await expect(adminPage.locator("[data-summary-row]")).toHaveCount(10);
    await expect(adminPage.getByText("Page 1 of 2")).toBeVisible();

    await adminPage.getByRole("link", { name: "Next" }).click();
    await expect(adminPage.getByText("Page 2 of 2")).toBeVisible();
    await expect(adminPage.getByTestId("summary-centres-on-plan")).toHaveText("4/9");
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
    await page.goto("/curriculum-summary?as_of=2026-02-30");
    await expect(page.getByLabel("As of")).toHaveValue(todayIst);
    await page.context().close();
  });
});
