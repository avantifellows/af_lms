import type { Locator, Page } from "@playwright/test";
import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

// Fixture: e2e/fixtures/migrations/20261027120000_seed_visit_summary_school_wise_fixture.sql.
// One completed Visit by FIXTURE_PM at each of five Schools; only VSWPHYS (physical-only),
// VSWMIXED (physical + NVS Centres) and VSWNOREG (no region) have an active physical Centre, so
// only they are in view. VSWPHYS and VSWMIXED are in region VSW_E2E. SECOND_PM adds two Visits at
// VSWPHYS (one two days ago, one in progress on 2026-09-01) and two in 2025 at VSWOLD (physical).
const FIXTURE_PM = "e2e-vsw-pm@test.local";
const SECOND_PM = "e2e-vsw-pm2@test.local";
const BOTH_PMS = `${FIXTURE_PM},${SECOND_PM}`;
const SEATED_PM = { name: "VSW Seated PM", email: "e2e-vsw-seated-pm@test.local" };
const PHYSICAL_SCHOOL = "VSW Physical School (VSWPHYS)";
const MIXED_SCHOOL = "VSW Mixed JNV (VSWMIXED)";
const NVS_ONLY_SCHOOL = "VSW NVS-only JNV (VSWNVS)";
const INACTIVE_CENTRE_SCHOOL = "VSW Inactive Centre School (VSWOFF)";
const NO_REGION_SCHOOL = "VSW No Region School (VSWNOREG)";
const NO_REGION = "No region (non-JNV)";

// Compact Visit dates (the School-wise Last visit pill, the School page cards) drop the year only
// in the current IST year, so each literal is given both ways.
const IN_FIXTURE_YEAR = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric" })
  .format(new Date()) === "2026";
function compactDates(inFixtureYear: string, otherYear: string) {
  return IN_FIXTURE_YEAR ? inFixtureYear : otherYear;
}

const STALE_LABEL = "Stale: last visit over 45 days ago";

// The stat cards both tabs share: Total visits, Completed, Schools, PMs, Schools with recurring concerns.
function statValue(page: Page, label: string) {
  return page
    .getByRole("group", { name: "Visit totals" })
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div[1]");
}

function visitRows(page: Page) {
  return page.locator("table tbody tr");
}

function schoolRows(page: Page) {
  return page.getByRole("table", { name: "Schools with visits" }).locator("tbody tr");
}

// The School (name, then region), Visits, Last visit, Open concerns, Recurring issues, Flags and
// Top recurring concern cells of each School-wise row, top to bottom.
function schoolColumn(page: Page, column: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
  return schoolRows(page).locator(`td:nth-child(${column + 1})`);
}

function schoolRow(page: Page, schoolName: string) {
  return schoolRows(page).filter({ hasText: schoolName });
}

function tab(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Visit Summary views" }).getByRole("link", { name, exact: true });
}

function sortHeader(page: Page, name: string | RegExp) {
  return page.getByRole("table", { name: "Schools with visits" }).getByRole("columnheader").getByRole("link", { name });
}

function filter(page: Page, label: string) {
  return page.getByRole("group", { name: label, exact: true });
}

// Opens a Region / School / PM multi-select (a no-op when it is already open).
async function openOptions(page: Page, label: string) {
  const button = filter(page, label).getByRole("button");
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
  }
}

async function optionNames(page: Page, label: string) {
  await openOptions(page, label);
  return filter(page, label).locator("label");
}

async function withPool<T>(fn: (pool: ReturnType<typeof getTestPool>) => Promise<T>): Promise<T> {
  const pool = getTestPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

test.describe("School Visit Summary — physical centres only", () => {
  test("lists, counts and offers only Schools with an active physical Centre", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?tab=visits&pms=${FIXTURE_PM}`);

    await expect(visitRows(adminPage)).toHaveCount(3);
    await expect(visitRows(adminPage).filter({ hasText: PHYSICAL_SCHOOL })).toHaveCount(1);
    await expect(visitRows(adminPage).filter({ hasText: MIXED_SCHOOL })).toHaveCount(1);
    await expect(visitRows(adminPage).filter({ hasText: NO_REGION_SCHOOL })).toHaveCount(1);
    await expect(visitRows(adminPage).filter({ hasText: NVS_ONLY_SCHOOL })).toHaveCount(0);
    await expect(visitRows(adminPage).filter({ hasText: INACTIVE_CENTRE_SCHOOL })).toHaveCount(0);

    await expect(statValue(adminPage, "Total visits")).toHaveText("3");
    await expect(statValue(adminPage, "Completed")).toHaveText("3");
    await expect(statValue(adminPage, "Schools")).toHaveText("3");
    await expect(statValue(adminPage, "PMs")).toHaveText("1");
    await expect(adminPage.getByText("3 visits found", { exact: true })).toBeVisible();

    // The School options keep the PM filter, so they are exactly the fixture PM's Schools in view.
    await expect(await optionNames(adminPage, "School")).toHaveText([MIXED_SCHOOL, NO_REGION_SCHOOL, PHYSICAL_SCHOOL]);
  });

  test("keeps NVS-only and inactive-Centre Schools out even when filtered for directly", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary?tab=visits&schools=VSWNVS,VSWOFF");

    await expect(adminPage.getByText("No visits match your filters")).toBeVisible();
    await expect(statValue(adminPage, "Total visits")).toHaveText("0");
    await expect(statValue(adminPage, "Schools")).toHaveText("0");

    // Unfiltered by School, the options never include them, and the fixture PM is still offered
    // only through their in-view Visits.
    await adminPage.goto("/school-visit-summary?tab=visits");
    const schoolOptions = await optionNames(adminPage, "School");
    await expect(schoolOptions.filter({ hasText: PHYSICAL_SCHOOL })).toHaveCount(1);
    await expect(schoolOptions.filter({ hasText: MIXED_SCHOOL })).toHaveCount(1);
    await expect(schoolOptions.filter({ hasText: NVS_ONLY_SCHOOL })).toHaveCount(0);
    await expect(schoolOptions.filter({ hasText: INACTIVE_CENTRE_SCHOOL })).toHaveCount(0);
  });

  test("drops the fixture PM from the PM options when only their out-of-view Visits match", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary?tab=visits&schools=VSWNVS");

    await expect((await optionNames(adminPage, "PM")).filter({ hasText: FIXTURE_PM })).toHaveCount(0);
  });
});

test.describe("School Visit Summary — Region, School and PM filters", () => {
  test("offers the Regions in view and filters to Schools with no region", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?tab=visits&pms=${FIXTURE_PM}`);
    await expect(filter(adminPage, "Region").getByRole("button")).toHaveText("All regions");

    // Only the fixture PM's in-view Schools' regions, so the dump's other regions are absent.
    await expect(await optionNames(adminPage, "Region")).toHaveText(["VSW_E2E", NO_REGION]);

    await filter(adminPage, "Region").getByRole("checkbox", { name: NO_REGION }).check();
    await expect(adminPage).toHaveURL(/[?&]regions=__none__(&|$)/);
    await expect(adminPage).not.toHaveURL(/[?&]page=/);

    await expect(visitRows(adminPage)).toHaveCount(1);
    await expect(visitRows(adminPage).filter({ hasText: NO_REGION_SCHOOL })).toHaveCount(1);
    await expect(statValue(adminPage, "Total visits")).toHaveText("1");
    await expect(filter(adminPage, "Region").getByRole("button")).toHaveText(NO_REGION);
    // Picking a Region never hides the other Regions.
    await expect(filter(adminPage, "Region").getByRole("checkbox", { name: "VSW_E2E" })).not.toBeChecked();
  });

  test("picking a Region narrows the School options", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?tab=visits&pms=${FIXTURE_PM}`);

    await openOptions(adminPage, "Region");
    await filter(adminPage, "Region").getByRole("checkbox", { name: "VSW_E2E" }).check();
    await expect(adminPage).toHaveURL(/[?&]regions=VSW_E2E(&|$)/);
    await expect(visitRows(adminPage)).toHaveCount(2);

    await expect(await optionNames(adminPage, "School")).toHaveText([MIXED_SCHOOL, PHYSICAL_SCHOOL]);
  });

  test("searches School options and lists the ticked School first", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?tab=visits&pms=${FIXTURE_PM}&schools=VSWPHYS`);
    await expect(filter(adminPage, "School").getByRole("button")).toHaveText(PHYSICAL_SCHOOL);

    await expect(await optionNames(adminPage, "School")).toHaveText([PHYSICAL_SCHOOL, MIXED_SCHOOL, NO_REGION_SCHOOL]);
    await expect(filter(adminPage, "School").getByRole("checkbox", { name: PHYSICAL_SCHOOL })).toBeChecked();

    await filter(adminPage, "School").getByRole("searchbox", { name: "Search School" }).fill("mIxEd");
    await expect(filter(adminPage, "School").locator("label")).toHaveText([MIXED_SCHOOL]);

    await filter(adminPage, "School").getByRole("checkbox", { name: MIXED_SCHOOL }).check();
    await expect(adminPage).toHaveURL(/[?&]schools=VSWPHYS%2CVSWMIXED(&|$)/);
    await expect(filter(adminPage, "School").getByRole("button")).toHaveText("2 schools");
    await expect(visitRows(adminPage)).toHaveCount(2);
  });

  test("an unknown region yields no rows rather than an error", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary?tab=visits&regions=NOT_A_REGION");

    await expect(adminPage.getByText("No visits match your filters")).toBeVisible();
    await expect(statValue(adminPage, "Total visits")).toHaveText("0");
    await expect(filter(adminPage, "Region").getByRole("button")).toHaveText("NOT_A_REGION (not in results)");
  });
});

// School-wise rows for BOTH_PMS, by School name (hand-counted from the fixture):
//   VSW Mixed JNV         1 Visit,  last 06 Oct 2026
//   VSW No Region School  1 Visit,  last 09 Oct 2026
//   VSW Old Visit School  2 Visits, last 01 Aug 2025 (stale)
//   VSW Physical School   3 Visits, last two days ago
const MIXED = "VSW Mixed JNV";
const NO_REGION_NAME = "VSW No Region School";
const OLD = "VSW Old Visit School";
const PHYSICAL = "VSW Physical School";

test.describe("School Visit Summary — School-wise tab", () => {
  test("is the default tab: one row per School in view with its Visits and Last visit", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}`);

    await expect(tab(adminPage, "School-wise")).toHaveAttribute("aria-current", "page");
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${MIXED} VSW_E2E`,
      NO_REGION_NAME,
      `${OLD} VSW_E2E`,
      `${PHYSICAL} VSW_E2E`,
    ]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["1", "1", "2", "3"]);
    await expect(schoolColumn(adminPage, 2).nth(0)).toHaveText(compactDates("06 Oct", "06 Oct 2026"));
    await expect(schoolColumn(adminPage, 2).nth(1)).toHaveText(compactDates("09 Oct", "09 Oct 2026"));
    await expect(schoolColumn(adminPage, 2).nth(2)).toHaveText(new RegExp(`^01 Aug 2025 ?${STALE_LABEL}$`));
    await expect(schoolRow(adminPage, MIXED).locator("time")).toHaveAttribute("datetime", "2026-10-06");
    await expect(schoolRow(adminPage, MIXED).locator("span[title]", { has: adminPage.locator("time") })).toHaveAttribute(
      "title",
      "06 Oct 2026"
    );

    await expect(statValue(adminPage, "Total visits")).toHaveText("7");
    await expect(statValue(adminPage, "Schools")).toHaveText("4");
    await expect(statValue(adminPage, "PMs")).toHaveText("2");
    await expect(adminPage.getByText("7 visits found", { exact: true })).toBeVisible();
    await expect(adminPage.getByText("4 schools", { exact: true })).toBeVisible();
  });

  test("flags a Last visit more than 45 days ago as stale", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}`);

    // The pill keeps the meaning of the old "Stale" tag in its title and a screen-reader label.
    await expect(schoolRow(adminPage, OLD).getByText(STALE_LABEL, { exact: true })).toHaveCount(1);
    await expect(schoolRow(adminPage, OLD).locator("[title]").filter({ hasText: "01 Aug" })).toHaveAttribute(
      "title",
      `01 Aug 2025 · ${STALE_LABEL}`
    );
    await expect(schoolRow(adminPage, PHYSICAL).getByText(STALE_LABEL, { exact: true })).toHaveCount(0);
  });

  test("Visits and Last visit follow the PM, status, date and required-actions filters", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} VSW_E2E`, NO_REGION_NAME, `${PHYSICAL} VSW_E2E`]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["1", "1", "1"]);
    await expect(schoolRow(adminPage, PHYSICAL)).toContainText(compactDates("05 Oct", "05 Oct 2026"));

    await adminPage.goto(`/school-visit-summary?pms=${SECOND_PM}&status=completed`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${OLD} VSW_E2E`, `${PHYSICAL} VSW_E2E`]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["2", "1"]);

    await adminPage.goto(`/school-visit-summary?pms=${SECOND_PM}&status=in_progress`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${PHYSICAL} VSW_E2E`]);
    await expect(schoolRow(adminPage, PHYSICAL)).toContainText(compactDates("01 Sep", "01 Sep 2026"));

    await adminPage.goto(`/school-visit-summary?pms=${SECOND_PM}&from=2025-07-20&to=2025-12-31`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${OLD} VSW_E2E`]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["1"]);
    await expect(schoolRow(adminPage, OLD)).toContainText("01 Aug 2025");

    // No fixture Visit has any Action, so none has every required Action complete.
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}&bucket=all_complete`);
    await expect(adminPage.getByText("No schools match your filters")).toBeVisible();
    await expect(statValue(adminPage, "Schools")).toHaveText("0");
  });

  test("sorts by each header in both directions, ties by School name", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}`);

    await sortHeader(adminPage, "Visits").click();
    await expect(adminPage).toHaveURL(/[?&]sort=visits&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["3", "2", "1", "1"]);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${PHYSICAL} VSW_E2E`, `${OLD} VSW_E2E`, `${MIXED} VSW_E2E`, NO_REGION_NAME,
    ]);

    await sortHeader(adminPage, "Visits").click();
    await expect(adminPage).toHaveURL(/[?&]sort=visits&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${MIXED} VSW_E2E`, NO_REGION_NAME, `${OLD} VSW_E2E`, `${PHYSICAL} VSW_E2E`,
    ]);

    await sortHeader(adminPage, "Last visit").click();
    await expect(adminPage).toHaveURL(/[?&]sort=last_visit&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${PHYSICAL} VSW_E2E`, NO_REGION_NAME, `${MIXED} VSW_E2E`, `${OLD} VSW_E2E`,
    ]);

    await sortHeader(adminPage, "Last visit").click();
    await expect(adminPage).toHaveURL(/[?&]sort=last_visit&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${OLD} VSW_E2E`, `${MIXED} VSW_E2E`, NO_REGION_NAME, `${PHYSICAL} VSW_E2E`,
    ]);

    await sortHeader(adminPage, /^School/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=school_name&dir=asc(&|$)/);
    await sortHeader(adminPage, /^School/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=school_name&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${PHYSICAL} VSW_E2E`, `${OLD} VSW_E2E`, NO_REGION_NAME, `${MIXED} VSW_E2E`,
    ]);
  });

  test("ignores the other tab's sort key", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}&sort=completed_at&dir=asc`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${MIXED} VSW_E2E`, NO_REGION_NAME, `${OLD} VSW_E2E`, `${PHYSICAL} VSW_E2E`,
    ]);

    await adminPage.goto(`/school-visit-summary?tab=visits&pms=${FIXTURE_PM}&sort=last_visit&dir=desc`);
    await expect(visitRows(adminPage)).toHaveCount(3);
    await expect(visitRows(adminPage).first()).toContainText(NO_REGION_SCHOOL);
  });

  test("switching tabs keeps the filters and drops sort, dir and page", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?regions=VSW_E2E&pms=${FIXTURE_PM}&status=completed&sort=visits&dir=asc`);
    await expect(schoolRows(adminPage)).toHaveCount(2);

    await tab(adminPage, "Visits").click();
    await expect(adminPage).toHaveURL(/[?&]tab=visits(&|$)/);
    await expect(tab(adminPage, "Visits")).toHaveAttribute("aria-current", "page");
    const visitsUrl = new URL(adminPage.url());
    expect(Object.fromEntries(visitsUrl.searchParams)).toEqual({
      tab: "visits",
      regions: "VSW_E2E",
      pms: FIXTURE_PM,
      status: "completed",
    });
    await expect(visitRows(adminPage)).toHaveCount(2);
    await expect(statValue(adminPage, "Total visits")).toHaveText("2");

    await adminPage.goto(`${visitsUrl.pathname}${visitsUrl.search}&sort=school_name&dir=desc&page=1`);
    await tab(adminPage, "School-wise").click();
    await expect(adminPage).toHaveURL(/[?&]tab=schools(&|$)/);
    expect(Object.fromEntries(new URL(adminPage.url()).searchParams)).toEqual({
      tab: "schools",
      regions: "VSW_E2E",
      pms: FIXTURE_PM,
      status: "completed",
    });
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} VSW_E2E`, `${PHYSICAL} VSW_E2E`]);
  });

  test("a PM with a pm seat sees only their visit-managed physical-centre Schools", async ({ page }) => {
    await signInAs(page, SEATED_PM);
    await page.goto("/school-visit-summary");

    // Seated at VSWPHYS and at NVS-only VSWNVS: only VSWPHYS shows, with every PM's Visits there.
    await expect(schoolColumn(page, 0)).toHaveText([`${PHYSICAL} VSW_E2E`]);
    await expect(schoolColumn(page, 1)).toHaveText(["3"]);
    await expect(statValue(page, "Schools")).toHaveText("1");
    await expect(statValue(page, "Total visits")).toHaveText("3");
  });
});

// Visit Concerns fixture: e2e/fixtures/migrations/20261027140100_seed_visit_concerns_fixture.sql
// (its header lists every record and the hand-worked answers asserted below).
const CONCERN_PM = "e2e-vsw-pm3@test.local";
const CONCERN_PM_2 = "e2e-vsw-pm4@test.local";
const ALPHA = "VSW Concern Alpha";
const BRAVO = "VSW Concern Bravo";
const CHARLIE = "VSW Concern Charlie";
const DELTA = "VSW Concern Delta";
const HTML_CONCERN = "Students lack <b>practice</b> tests <img src=x onerror=alert(1)>";
// 9004802's snippet on the 15 Sep Visit, also HTML-shaped (School page mention lines).
const HTML_SNIPPET = "Practice tests still <b>missing</b> <img src=x onerror=alert(2)>";

test.describe("School Visit Summary — Recurring Concerns on the School-wise tab", () => {
  test("counts Recurring and open Concerns per School, most recurring first", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);

    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${ALPHA} VSW_E2E`, `${BRAVO} VSW_E2E`, `${CHARLIE} VSW_E2E`, `${DELTA} VSW_E2E`,
    ]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["5", "3", "1", "1"]);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["4", "2", "1", "0"]);
    await expect(schoolColumn(adminPage, 4)).toHaveText(["3", "1", "0", "0"]);

    await expect(statValue(adminPage, "Schools")).toHaveText("4");
    await expect(statValue(adminPage, "Total visits")).toHaveText("10");
    await expect(statValue(adminPage, "PMs")).toHaveText("1");
    await expect(statValue(adminPage, "Schools with recurring concerns")).toHaveText("2");

    // Alpha's three 2-visit concerns tie; the 15 Sep ones beat the 06 Aug one, then the lower id wins.
    await expect(schoolColumn(adminPage, 6).nth(0)).toHaveText(`${HTML_CONCERN}2 visits`);
    await expect(schoolColumn(adminPage, 6).nth(1)).toHaveText("Smartboard not working3 visits");
    await expect(schoolColumn(adminPage, 6).nth(2)).toHaveText("—");
    await expect(schoolColumn(adminPage, 6).nth(3)).toHaveText("—");

    await expect(schoolRow(adminPage, ALPHA).getByRole("img", { name: "3 or more recurring concerns" })).toBeVisible();
    await expect(schoolRow(adminPage, BRAVO).getByRole("img", { name: "1–2 recurring concerns" })).toBeVisible();
    await expect(schoolRow(adminPage, CHARLIE).getByRole("img", { name: "Open concerns, none recurring" })).toBeVisible();
    await expect(schoolRow(adminPage, DELTA).getByRole("img", { name: "No open concerns" })).toBeVisible();
  });

  test("shows Open concerns just before Recurring issues as a plain number, sortable most first", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);

    const headers = adminPage.getByRole("table", { name: "Schools with visits" }).getByRole("columnheader");
    await expect(headers).toHaveText([
      "School", "Visits", "Last visit", "Open concerns", /^Recurring issues/, "Student flags", "Top recurring concern", "Open School page",
    ]);
    // No red circle or highlight: just the number, styled like Visits.
    const open = schoolColumn(adminPage, 3);
    await expect(open).toHaveText(["4", "2", "1", "0"]);
    await expect(open.locator("*")).toHaveCount(0);
    expect(await open.first().getAttribute("class")).toBe(await schoolColumn(adminPage, 1).first().getAttribute("class"));

    await sortHeader(adminPage, "Open concerns").click();
    await expect(adminPage).toHaveURL(/[?&]sort=open&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["4", "2", "1", "0"]);
    await sortHeader(adminPage, /Open concerns/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=open&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${DELTA} VSW_E2E`, `${CHARLIE} VSW_E2E`, `${BRAVO} VSW_E2E`, `${ALPHA} VSW_E2E`,
    ]);
  });

  test("counts only Visits in view: dates and PMs change Recurring counts", async ({ adminPage }) => {
    // August only: Alpha's two same-day Visits are two mentions of "Lab equipment missing".
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&from=2026-08-01&to=2026-08-31`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${ALPHA} VSW_E2E`, `${BRAVO} VSW_E2E`]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["2", "1"]);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["1", "1"]);
    await expect(schoolColumn(adminPage, 4)).toHaveText(["1", "0"]);
    await expect(schoolColumn(adminPage, 6).nth(0)).toHaveText("Lab equipment missing2 visits");
    await expect(statValue(adminPage, "Schools with recurring concerns")).toHaveText("1");
    await expect(schoolRow(adminPage, ALPHA).getByRole("img", { name: "1–2 recurring concerns" })).toBeVisible();

    // Alpha over every Visit: the resolved concern, the highlight and the concern mentioned only
    // in the soft-deleted Visit don't count.
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&schools=VSWCONA`);
    await expect(schoolColumn(adminPage, 4)).toHaveText(["3"]);
    await expect(schoolRow(adminPage, ALPHA).getByRole("img", { name: "3 or more recurring concerns" })).toBeVisible();

    // From September: the soft-deleted Visit's mention doesn't make "Timetable clashes" recur.
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&schools=VSWCONA&from=2026-09-01`);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["3"]);
    await expect(schoolColumn(adminPage, 4)).toHaveText(["0"]);
    await expect(schoolRow(adminPage, ALPHA).getByRole("img", { name: "Open concerns, none recurring" })).toBeVisible();

    // Adding the second PM's Visit makes "Library closed" recur at Bravo; the 3-visit concern stays top.
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM},${CONCERN_PM_2}&schools=VSWCONB`);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["4"]);
    await expect(schoolColumn(adminPage, 4)).toHaveText(["2"]);
    await expect(schoolColumn(adminPage, 6)).toHaveText(["Smartboard not working3 visits"]);
  });

  test("sorts by Recurring issues both ways, ties by School name; Top recurring concern isn't sortable", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);
    await expect(sortHeader(adminPage, /Top recurring concern/)).toHaveCount(0);

    await sortHeader(adminPage, /Recurring issues/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=recurring&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${CHARLIE} VSW_E2E`, `${DELTA} VSW_E2E`, `${BRAVO} VSW_E2E`, `${ALPHA} VSW_E2E`,
    ]);

    await sortHeader(adminPage, /Recurring issues/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=recurring&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${ALPHA} VSW_E2E`, `${BRAVO} VSW_E2E`, `${CHARLIE} VSW_E2E`, `${DELTA} VSW_E2E`,
    ]);
  });

  test("Recurring concerns only keeps Schools with a Recurring Concern, and the Visits tab link keeps it", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);

    await adminPage.getByRole("checkbox", { name: "Recurring concerns only" }).check();
    await expect(adminPage).toHaveURL(/[?&]recurring=1(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${ALPHA} VSW_E2E`, `${BRAVO} VSW_E2E`]);
    await expect(statValue(adminPage, "Schools")).toHaveText("2");
    await expect(statValue(adminPage, "Total visits")).toHaveText("8");
    await expect(statValue(adminPage, "Schools with recurring concerns")).toHaveText("2");
    await expect(adminPage.getByText("8 visits found", { exact: true })).toBeVisible();
    await expect(adminPage.getByText("2 schools", { exact: true })).toBeVisible();
    await expect(tab(adminPage, "Visits")).toHaveAttribute("href", /[?&]recurring=1(&|$)/);

    await adminPage.getByRole("checkbox", { name: "Recurring concerns only" }).uncheck();
    await expect(adminPage).not.toHaveURL(/[?&]recurring=/);
    await expect(schoolRows(adminPage)).toHaveCount(4);
  });

  test("says up to when Visit notes were summarised and how many Visits in view are waiting", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);
    await expect(adminPage.getByText("Visit notes summarised up to 20 Oct 2026, 14:00 · 1 visit waiting")).toBeVisible();

    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&from=2026-08-01&to=2026-08-31`);
    await expect(adminPage.getByText("Visit notes summarised up to 20 Oct 2026, 14:00 · 0 visits waiting")).toBeVisible();
  });

  test("before the first summary run, says so and still lists the Schools", async ({ adminPage }) => {
    await withPool(async (pool) => {
      const { rows: saved } = await pool.query(
        "SELECT visit_id, fingerprint, prompt_version, summarised_at::text AS summarised_at FROM lms_visit_note_summaries"
      );
      await pool.query("DELETE FROM lms_visit_note_summaries");
      try {
        await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}`);
        await expect(adminPage.getByText("Visit notes haven't been summarised yet")).toBeVisible();
        await expect(adminPage.getByText(/summarised up to/)).toHaveCount(0);
        await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} VSW_E2E`, NO_REGION_NAME, `${PHYSICAL} VSW_E2E`]);
        await expect(schoolColumn(adminPage, 4)).toHaveText(["0", "0", "0"]);
      } finally {
        for (const row of saved) {
          await pool.query(
            `INSERT INTO lms_visit_note_summaries (visit_id, fingerprint, prompt_version, summarised_at)
             VALUES ($1, $2, $3, $4)`,
            [row.visit_id, row.fingerprint, row.prompt_version, row.summarised_at]
          );
        }
      }
    });
  });

  test("renders concern text as text, never as HTML", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&schools=VSWCONA`);

    await expect(schoolRow(adminPage, ALPHA)).toContainText(HTML_CONCERN);
    await expect(schoolRow(adminPage, ALPHA).locator("b, img")).toHaveCount(0);
  });
});

// Flags fixture: e2e/fixtures/migrations/20261027140200_seed_visit_summary_flags_fixture.sql.
// VSWPHYS has two open flags and a resolved one (→ 2); VSWMIXED has an open Nodal flag and an
// open JNV NVS flag (→ 1). Every role that can see the Visit Summary also has `students` view and
// reaches each School in its summary scope, so "—" (no flag access) can't be reached here; the
// page test in src/app/school-visit-summary/page.test.tsx covers it.
test.describe("School Visit Summary — Flags on the School-wise tab", () => {
  test("counts open, non-NVS intervention flags per School", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}`);

    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${MIXED} VSW_E2E`, NO_REGION_NAME, `${OLD} VSW_E2E`, `${PHYSICAL} VSW_E2E`,
    ]);
    await expect(schoolColumn(adminPage, 5)).toHaveText(["1", "0", "0", "2"]);
  });

  test("sorts by Flags both ways, ties by School name", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}`);

    await sortHeader(adminPage, "Student flags").click();
    await expect(adminPage).toHaveURL(/[?&]sort=flags&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 5)).toHaveText(["2", "1", "0", "0"]);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${PHYSICAL} VSW_E2E`, `${MIXED} VSW_E2E`, NO_REGION_NAME, `${OLD} VSW_E2E`,
    ]);

    await sortHeader(adminPage, /Student flags/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=flags&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      NO_REGION_NAME, `${OLD} VSW_E2E`, `${MIXED} VSW_E2E`, `${PHYSICAL} VSW_E2E`,
    ]);
  });

  test("a seated PM sees the flag count at their visit-managed School", async ({ page }) => {
    await signInAs(page, SEATED_PM);
    await page.goto("/school-visit-summary");

    await expect(schoolColumn(page, 0)).toHaveText([`${PHYSICAL} VSW_E2E`]);
    await expect(schoolColumn(page, 5)).toHaveText(["2"]);
  });
});

// School page fixture: e2e/fixtures/migrations/20261027140300_seed_visit_summary_school_page_fixture.sql
// (its header works out the Teachers line asserted below).
function teacherLines(page: Page) {
  return page.getByRole("list", { name: "Teachers", exact: true }).getByRole("listitem").filter({ has: page.getByRole("list") });
}

function teacherChips(page: Page, tag: string) {
  return page.getByRole("list", { name: `${tag} teachers`, exact: true }).getByRole("listitem");
}

test.describe("School Visit Summary — School page", () => {
  test("a School-wise row opens the School page with the filters, and Back returns to the same table", async ({ adminPage }) => {
    const filters = {
      regions: "VSW_E2E",
      pms: FIXTURE_PM,
      status: "completed",
      sort: "school_name",
      dir: "asc",
    };
    await adminPage.goto(`/school-visit-summary?${new URLSearchParams(filters)}`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} VSW_E2E`, `${PHYSICAL} VSW_E2E`]);

    // Anywhere on the row opens it, not only the School name.
    await schoolRow(adminPage, MIXED).locator("td:nth-child(2)").click();
    await expect(adminPage).toHaveURL(/\/school-visit-summary\/schools\/VSWMIXED\?/);
    expect(Object.fromEntries(new URL(adminPage.url()).searchParams)).toEqual(filters);
    await expect(adminPage.getByRole("heading", { level: 1 })).toHaveText(MIXED);

    await adminPage.getByRole("link", { name: /Back to School-wise/ }).click();
    await expect(adminPage).toHaveURL(/\/school-visit-summary\?/);
    expect(Object.fromEntries(new URL(adminPage.url()).searchParams)).toEqual({ tab: "schools", ...filters });
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} VSW_E2E`, `${PHYSICAL} VSW_E2E`]);
  });

  test("lists the teachers seated at the active physical Centres, CoE and Nodal apart, without vacant seats", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary/schools/VSWMIXED");

    await expect(teacherLines(adminPage)).toHaveCount(2);
    await expect(teacherLines(adminPage).nth(0)).toContainText("CoE");
    await expect(teacherChips(adminPage, "CoE")).toHaveText([
      "BIOLOGY - Ravi Kumar",
      "PHYSICS - Asha Rao",
    ]);
    await expect(teacherLines(adminPage).nth(1)).toContainText("Nodal");
    await expect(teacherChips(adminPage, "Nodal")).toHaveText([
      "MATHS - Kiran Patel",
      "SUBJECT TBD - Meena Shah",
    ]);
    await expect(adminPage.getByText("Vacant")).toHaveCount(0);
    await expect(adminPage.getByText("Deleted Seat Teacher")).toHaveCount(0);
    await expect(adminPage.getByText("Closed Centre Teacher")).toHaveCount(0);
    await expect(adminPage.getByText("NVS Teacher")).toHaveCount(0);
    await expect(adminPage.getByText("VSW Page PM")).toHaveCount(0);
  });

  test("still renders when BigQuery is unavailable, with the academic levels marked unavailable", async ({ adminPage }) => {
    // The e2e web server has no BigQuery credentials (playwright.config.ts).
    await adminPage.goto("/school-visit-summary/schools/VSWMIXED");

    await expect(adminPage.getByText("Academic levels unavailable")).toBeVisible();
    await expect(teacherLines(adminPage)).toHaveCount(2);
    await expect(adminPage.getByRole("link", { name: /Back to School-wise/ })).toBeVisible();
  });

  test("is not found for an NVS-only School, a School whose only physical Centre is inactive, and an unknown code", async ({ adminPage }) => {
    for (const code of ["VSWNVS", "VSWOFF", "VSWNOSUCH"]) {
      const response = await adminPage.goto(`/school-visit-summary/schools/${code}`);
      expect(response?.status(), code).toBe(404);
    }
  });

  test("a seated PM opens their visit-managed physical-centre School and gets not found for others", async ({ page }) => {
    await signInAs(page, SEATED_PM);

    await page.goto("/school-visit-summary/schools/VSWPHYS");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(PHYSICAL);

    // VSWMIXED is outside their seats; VSWNVS is seated but has no physical Centre.
    for (const code of ["VSWMIXED", "VSWNVS"]) {
      const response = await page.goto(`/school-visit-summary/schools/${code}`);
      expect(response?.status(), code).toBe(404);
    }
  });
});

// School page concern fixture: e2e/fixtures/migrations/20261027140400_seed_visit_summary_school_page_concerns_fixture.sql
// (its header works out every section for VSWCONA).

// The open concerns' section heading (renamed from "Needs attention" at the stakeholder's request).
const NEEDS_ATTENTION = "All concerns - Need Attention";

function concernSection(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

function cards(page: Page, section: string) {
  return concernSection(page, section).getByRole("article");
}

const ALPHA_PAGE = "/school-visit-summary/schools/VSWCONA";

function highlights(page: Page) {
  return concernSection(page, "Going well").getByRole("listitem");
}

// A card's expand toggle, and the mention lines it shows when expanded (none while collapsed).
function cardToggle(card: Locator) {
  return card.locator("button[aria-expanded]");
}

function mentionLines(card: Locator) {
  return card.getByRole("list", { name: "What PMs said" }).getByRole("listitem");
}

// A card's history entries (not its mention lines).
function historyEntries(card: Locator) {
  return card.getByRole("list", { name: "History" }).getByRole("listitem");
}

async function mentionHrefs(card: Locator) {
  return mentionLines(card).getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
}

// One collapsible row per Visit in view.
function visitNoteRows(page: Page) {
  return concernSection(page, "Visit-wise notes").locator("details");
}

test.describe("School Visit Summary — School page concerns", () => {
  test("Needs attention lists the open concerns in view with their Visits, dates and reopened marker", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);

    const needs = cards(adminPage, NEEDS_ATTENTION);
    await expect(needs).toHaveCount(4);
    await expect(needs.nth(0)).toContainText(HTML_CONCERN);
    await expect(needs.nth(1)).toContainText("Physics teacher absent on Saturdays");
    await expect(needs.nth(2)).toContainText("Lab equipment missing");
    await expect(needs.nth(3)).toContainText("Timetable clashes with board exam preparation");

    await expect(needs.nth(0).getByText("Recurring · 2 visits", { exact: true })).toBeVisible();
    await expect(needs.nth(0).getByText(compactDates("15 Sep · 10 Jun", "15 Sep 2026 · 10 Jun 2026"), { exact: true })).toBeVisible();
    await expect(needs.nth(2).getByText(compactDates("06 Aug ×2", "06 Aug 2026 ×2"), { exact: true })).toBeVisible();
    // The in-progress Visit's and the soft-deleted Visit's mentions don't count: one Visit, one date.
    await expect(needs.nth(3)).not.toContainText("Recurring");
    await expect(needs.nth(3).getByText(compactDates("15 Sep", "15 Sep 2026"), { exact: true })).toBeVisible();

    await expect(needs.nth(0).getByText("reopened", { exact: true })).toBeVisible();
    await expect(needs.nth(1).getByText("reopened", { exact: true })).toBeVisible();
    await expect(needs.nth(2).getByText("reopened", { exact: true })).toHaveCount(0);
    await expect(needs.nth(3).getByText("reopened", { exact: true })).toHaveCount(0);

    // Concern text is stored text, rendered as text; the hidden concern never shows.
    await expect(needs.nth(0).locator("b, img")).toHaveCount(0);
    await expect(adminPage.getByText("Broken benches in the hostel")).toHaveCount(0);
  });

  test("a concern's history expands, with author names, the reopen and the automatic reopen", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);
    const needs = cards(adminPage, NEEDS_ATTENTION);

    const autoReopened = needs.nth(0).getByRole("listitem");
    await expect(autoReopened.first()).toBeHidden();
    await needs.nth(0).getByText("History (2)").click();
    await expect(autoReopened).toHaveCount(2);
    await expect(autoReopened.nth(0)).toContainText("Resolved · e2e-vsw-pm3@test.local · 12 Jun 2026");
    // The full IST time is on hover.
    await expect(autoReopened.nth(0).locator("time")).toHaveAttribute("title", "12 Jun 2026, 11:30");
    await expect(autoReopened.nth(0)).toContainText("Practice tests scheduled weekly");
    await expect(autoReopened.nth(1)).toContainText("Reopened automatically: raised again in visit of 15 Sep 2026");

    await needs.nth(1).getByText("History (2)").click();
    const reopened = needs.nth(1).getByRole("listitem");
    await expect(reopened.nth(0)).toContainText("Substitute teacher arranged");
    await expect(reopened.nth(1)).toContainText("Reopened · e2e-vsw-pm3@test.local · 17 Sep 2026");
    await expect(reopened.nth(1)).toContainText("Substitute left after a month");
  });

  test("the open concerns' heading reads \"All concerns - Need Attention\" with the open count", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);

    const section = concernSection(adminPage, NEEDS_ATTENTION);
    await expect(section.getByRole("heading", { level: 2 })).toHaveText(NEEDS_ATTENTION);
    await expect(section.getByText("4 open", { exact: true })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Needs attention" })).toHaveCount(0);
  });

  test("an open concern expands to what the PMs said, newest first, each line opening its Visit", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);
    const needs = cards(adminPage, NEEDS_ATTENTION);
    const card = needs.nth(0);

    await expect(cardToggle(card)).toHaveAttribute("aria-expanded", "false");
    await expect(mentionLines(card)).toHaveCount(0);
    await cardToggle(card).click();
    await expect(cardToggle(card)).toHaveAttribute("aria-expanded", "true");

    // Date · PM (their email: they have no permission row), then the snippet, rendered as text.
    await expect(mentionLines(card)).toHaveText([
      `15 Sep 2026 · ${CONCERN_PM}${HTML_SNIPPET}`,
      `10 Jun 2026 · ${CONCERN_PM}Few practice tests`,
    ]);
    await expect(card.locator("b, img")).toHaveCount(0);
    const back = `?${new URLSearchParams({ back: ALPHA_PAGE })}`;
    expect(await mentionHrefs(card)).toEqual([
      `/school-visit-summary/9004723${back}`,
      `/school-visit-summary/9004720${back}`,
    ]);

    // Only live mentions in view: the soft-deleted and in-progress Visits' mentions don't show.
    await cardToggle(needs.nth(3)).click();
    await expect(mentionLines(needs.nth(3))).toHaveText([`15 Sep 2026 · ${CONCERN_PM}Timetable clash`]);

    // It collapses again.
    await cardToggle(card).click();
    await expect(cardToggle(card)).toHaveAttribute("aria-expanded", "false");
    await expect(mentionLines(card)).toHaveCount(0);

    // A line opens its Visit, whose Back returns here.
    await mentionLines(needs.nth(3)).first().getByRole("link").click();
    await expect(adminPage).toHaveURL(/\/school-visit-summary\/9004723\?back=/);
    await adminPage.getByRole("link", { name: /Back to Visit Summary/ }).click();
    await expect(adminPage).toHaveURL(ALPHA_PAGE);
  });

  test("resolved concerns and highlights expand too, and the mention lines follow the URL filters", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);

    const resolved = cards(adminPage, "Resolved concerns").first();
    await cardToggle(resolved).click();
    await expect(mentionLines(resolved)).toHaveText([
      `15 Sep 2026 · ${CONCERN_PM}Cooler broken`,
      `06 Aug 2026 · ${CONCERN_PM}Cooler still broken`,
      `10 Jun 2026 · ${CONCERN_PM}Cooler not working`,
    ]);
    await expect(historyEntries(resolved)).toHaveCount(2);

    const highlight = highlights(adminPage).first();
    await cardToggle(highlight).click();
    await expect(mentionLines(highlight)).toHaveText([
      `15 Sep 2026 · ${CONCERN_PM}Peer learning strong`,
      `06 Aug 2026 · ${CONCERN_PM}Peer groups active`,
      `06 Aug 2026 · ${CONCERN_PM}Peer groups active`,
      `10 Jun 2026 · ${CONCERN_PM}Students teach each other`,
    ]);

    // August only: the two same-day Visits, newest (higher id) first, linking Back with the filters.
    const august = `${ALPHA_PAGE}?from=2026-08-01&to=2026-08-31`;
    await adminPage.goto(august);
    const card = cards(adminPage, NEEDS_ATTENTION).first();
    await cardToggle(card).click();
    await expect(mentionLines(card)).toHaveText([
      `06 Aug 2026 · ${CONCERN_PM}Chemistry lab still short of equipment`,
      `06 Aug 2026 · ${CONCERN_PM}Lab has no burettes`,
    ]);
    const back = `?${new URLSearchParams({ back: august })}`;
    expect(await mentionHrefs(card)).toEqual([
      `/school-visit-summary/9004722${back}`,
      `/school-visit-summary/9004721${back}`,
    ]);
  });

  test("Going well lists the highlights in view", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);

    const going = highlights(adminPage);
    await expect(going).toHaveCount(1);
    await expect(going.nth(0)).toContainText("Strong peer learning culture");
    await expect(going.nth(0).getByText(
      compactDates("15 Sep · 06 Aug ×2 · 10 Jun", "15 Sep 2026 · 06 Aug 2026 ×2 · 10 Jun 2026"),
      { exact: true }
    )).toBeVisible();
  });

  test("Resolved concerns shows who resolved each one, when, and the history", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);

    const resolved = cards(adminPage, "Resolved concerns");
    await expect(resolved).toHaveCount(1);
    await expect(resolved.first()).toBeVisible();
    await expect(resolved.first()).toContainText("Water cooler broken");
    await expect(resolved.first()).toContainText("Resolved by e2e-vsw-pm3@test.local · 16 Sep 2026");

    const history = resolved.first().getByRole("listitem");
    await expect(history).toHaveCount(2);
    await expect(history.nth(0)).toContainText("School replaced the cooler");
    // The author has a case-variant duplicate permission row: one entry, the first row's name.
    await expect(history.nth(1)).toContainText("Comment · VSW Resolver · 20 Sep 2026");
    await expect(history.nth(1)).toContainText("Cooler checked again and working");
    await expect(adminPage.getByText("VSW Resolver Duplicate")).toHaveCount(0);
  });

  test("Visit-wise notes lists every Visit in view with its concerns and highlights, linking to the Visit", async ({ adminPage }) => {
    await adminPage.goto(ALPHA_PAGE);

    const notes = concernSection(adminPage, "Visit-wise notes");
    const rows = visitNoteRows(adminPage);
    await expect(rows).toHaveCount(6);
    // Collapsed: each row reads date, PM, concern and highlight counts (and In progress).
    await expect(rows.nth(0).locator("summary")).toHaveText(
      "▸01 Oct 2026e2e-vsw-pm4@test.local· 0 concerns · 0 highlightsIn progress"
    );
    const visitLinks = notes.getByRole("link", { includeHidden: true });
    await expect(visitLinks).toHaveCount(6);
    await expect(visitLinks.first()).toBeHidden();
    const hrefs = await visitLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const back = `?${new URLSearchParams({ back: ALPHA_PAGE })}`;
    expect(hrefs).toEqual([
      `/school-visit-summary/9004732${back}`,
      `/school-visit-summary/9004725${back}`,
      `/school-visit-summary/9004723${back}`,
      `/school-visit-summary/9004722${back}`,
      `/school-visit-summary/9004721${back}`,
      `/school-visit-summary/9004720${back}`,
    ]);

    // Expanding a row shows its notes and the link to the Visit; it collapses again.
    await rows.nth(0).locator("summary").click();
    await expect(rows.nth(0).getByText("No concerns or highlights")).toBeVisible();
    await expect(rows.nth(0).getByRole("link", { name: "Open visit details" })).toBeVisible();
    await expect(rows.nth(0)).not.toContainText("Timetable clashes");
    await rows.nth(2).locator("summary").click();
    await expect(rows.nth(2).getByText("Timetable clashes with board exam preparation")).toBeVisible();
    await expect(rows.nth(2).getByText("Water cooler broken")).toBeVisible();
    await expect(rows.nth(2).getByText("Strong peer learning culture")).toBeVisible();
    await expect(rows.nth(3)).not.toContainText("Water cooler broken");

    await rows.nth(0).locator("summary").click();
    await expect(visitLinks.first()).toBeHidden();
  });

  test("a Visit opened from the School page goes Back to that School page", async ({ adminPage }) => {
    const schoolPage = `${ALPHA_PAGE}?from=2026-08-01&to=2026-10-31`;
    await adminPage.goto(schoolPage);

    await visitNoteRows(adminPage).first().locator("summary").click();
    await visitNoteRows(adminPage).first().getByRole("link", { name: "Open visit details" }).click();
    await expect(adminPage).toHaveURL(/\/school-visit-summary\/9004732\?back=/);

    await adminPage.getByRole("link", { name: /Back to Visit Summary/ }).click();
    await expect(adminPage).toHaveURL(schoolPage);
  });

  test("follows the date and PM filters carried in the URL", async ({ adminPage }) => {
    await adminPage.goto(`${ALPHA_PAGE}?from=2026-08-01&to=2026-08-31`);

    await expect(cards(adminPage, NEEDS_ATTENTION)).toHaveCount(1);
    await expect(cards(adminPage, NEEDS_ATTENTION).first()).toContainText("Lab equipment missing");
    await expect(cards(adminPage, NEEDS_ATTENTION).first().getByText("Recurring · 2 visits", { exact: true })).toBeVisible();
    await expect(highlights(adminPage).first().getByText(compactDates("06 Aug ×2", "06 Aug 2026 ×2"), { exact: true })).toBeVisible();
    await expect(cards(adminPage, "Resolved concerns")).toHaveCount(1);
    await expect(visitNoteRows(adminPage)).toHaveCount(2);
    // The header counts follow the same filters.
    await expect(adminPage.getByRole("list", { name: "Concern counts" }).getByRole("listitem")).toHaveText([
      "1 open concern",
      "1 recurring",
      "1 highlight",
      "1 resolved",
    ]);

    // Only the in-progress Visit is in view: nothing counts, and each section says so.
    await adminPage.goto(`${ALPHA_PAGE}?pms=${CONCERN_PM_2}`);
    await expect(concernSection(adminPage, NEEDS_ATTENTION)).toContainText("No open concerns in view");
    await expect(concernSection(adminPage, "Going well")).toContainText("No highlights in view");
    await expect(concernSection(adminPage, "Resolved concerns")).toContainText("No resolved concerns in view");
    await expect(visitNoteRows(adminPage)).toHaveCount(1);
  });
});

// Concern Resolution fixture: e2e/fixtures/migrations/20261027140500_seed_visit_concern_resolution_fixture.sql.
// These tests write history at VSWCONE only, and run in order (Comment needs the concern resolved
// before Reopen opens it).
const ECHO_PAGE = "/school-visit-summary/schools/VSWCONE";
const ECHO_PM = "e2e-vsw-pm5@test.local";
const READ_ONLY_USER = { name: "VSW Read Only", email: "e2e-vsw-readonly@test.local" };

function concernCard(page: Page, section: string, text: string) {
  return cards(page, section).filter({ hasText: text });
}

test.describe.serial("School Visit Summary — School page concern actions", () => {
  test("Resolve moves an open concern to Resolved with the explanation in its history", async ({ adminPage }) => {
    await adminPage.goto(ECHO_PAGE);
    const card = concernCard(adminPage, NEEDS_ATTENTION, "Drinking water tank leaking");

    await card.getByRole("button", { name: "Resolve" }).click();
    // Resolve expands the card: what the PMs said sits above the note.
    await expect(cardToggle(card)).toHaveAttribute("aria-expanded", "true");
    await expect(mentionLines(card)).toHaveText([`05 Sep 2026 · ${ECHO_PM}Water tank leaks near the hostel`]);
    const lineBox = await mentionLines(card).first().boundingBox();
    const noteBox = await card.getByRole("textbox", { name: "How was this resolved?" }).boundingBox();
    expect(lineBox!.y + lineBox!.height).toBeLessThanOrEqual(noteBox!.y);
    await card.getByRole("textbox", { name: "How was this resolved?" }).fill("  Plumber fixed the tank  ");
    await card.getByRole("button", { name: "Mark resolved" }).click();

    await expect(concernCard(adminPage, NEEDS_ATTENTION, "Drinking water tank leaking")).toHaveCount(0);
    const resolved = concernCard(adminPage, "Resolved concerns", "Drinking water tank leaking");
    await expect(resolved).toContainText("Resolved by e2e-admin@test.local ·");
    const history = historyEntries(resolved);
    await expect(history).toHaveCount(1);
    await expect(history.first()).toContainText("Resolved · e2e-admin@test.local");
    await expect(history.first()).toContainText("Plumber fixed the tank");
  });

  test("Comment adds to a resolved concern's history without changing its status", async ({ adminPage }) => {
    await adminPage.goto(ECHO_PAGE);
    const card = concernCard(adminPage, "Resolved concerns", "Hostel lights not working");

    await card.getByRole("button", { name: "Comment" }).click();
    await expect(mentionLines(card)).toHaveCount(2);
    await card.getByRole("textbox", { name: "Comment" }).fill("Lights checked on the next visit");
    await card.getByRole("button", { name: "Add comment" }).click();

    const history = historyEntries(card);
    await expect(history).toHaveCount(2);
    await expect(history.nth(1)).toContainText("Comment · e2e-admin@test.local");
    await expect(history.nth(1)).toContainText("Lights checked on the next visit");
    await expect(concernCard(adminPage, NEEDS_ATTENTION, "Hostel lights not working")).toHaveCount(0);
  });

  test("Reopen moves a resolved concern back to Needs attention, marked reopened, with the reason", async ({ adminPage }) => {
    await adminPage.goto(ECHO_PAGE);
    const resolvedCard = concernCard(adminPage, "Resolved concerns", "Hostel lights not working");

    await resolvedCard.getByRole("button", { name: "Reopen" }).click();
    // Reopen expands the card too, newest mention first.
    await expect(cardToggle(resolvedCard)).toHaveAttribute("aria-expanded", "true");
    await expect(mentionLines(resolvedCard)).toHaveText([
      `05 Oct 2026 · ${ECHO_PM}Lights still flicker`,
      `05 Sep 2026 · ${ECHO_PM}Hostel corridor lights off`,
    ]);
    await resolvedCard.getByRole("textbox", { name: "Why is this being reopened?" }).fill("Lights failed again");
    await resolvedCard.getByRole("button", { name: "Reopen", exact: true }).click();

    const card = concernCard(adminPage, NEEDS_ATTENTION, "Hostel lights not working");
    await expect(card).toHaveCount(1);
    await expect(card.getByText("reopened", { exact: true })).toBeVisible();
    await expect(concernCard(adminPage, "Resolved concerns", "Hostel lights not working")).toHaveCount(0);
    await card.getByText("History (3)").click();
    const history = historyEntries(card);
    await expect(history.nth(2)).toContainText("Reopened · e2e-admin@test.local");
    await expect(history.nth(2)).toContainText("Lights failed again");
  });

  test("a too-long note is refused with the text kept, and a 409 refreshes the page", async ({ adminPage }) => {
    await adminPage.goto(ECHO_PAGE);
    const card = concernCard(adminPage, NEEDS_ATTENTION, "Exam timetable not shared");
    await card.getByRole("button", { name: "Resolve" }).click();
    const note = card.getByRole("textbox", { name: "How was this resolved?" });

    // Too long: refused before saving.
    const tooLong = "x".repeat(2001);
    await note.fill(tooLong);
    await card.getByRole("button", { name: "Mark resolved" }).click();
    await expect(card.getByRole("alert")).toHaveText("Note must be at most 2000 characters");
    await expect(note).toHaveValue(tooLong);

    // Someone else resolved it after the page loaded: the API's 409 refreshes the page, so the
    // concern shows in its current state, under Resolved concerns (the component test covers the
    // message shown while the refresh is in flight).
    await withPool((pool) =>
      pool.query("UPDATE lms_visit_concerns SET status = 'resolved' WHERE id = 9004815")
    );
    await note.fill("Timetable shared on the notice board");
    await card.getByRole("button", { name: "Mark resolved" }).click();
    await expect(concernCard(adminPage, NEEDS_ATTENTION, "Exam timetable not shared")).toHaveCount(0);
    await expect(concernCard(adminPage, "Resolved concerns", "Exam timetable not shared")).toHaveCount(1);
  });

  test("a read_only user sees concerns and history but no controls, and a direct POST is refused", async ({ page }) => {
    await signInAs(page, READ_ONLY_USER);
    await page.goto(ECHO_PAGE);

    await expect(concernCard(page, NEEDS_ATTENTION, "Hostel lights not working")).toHaveCount(1);
    await expect(concernCard(page, "Resolved concerns", "Drinking water tank leaking")).toContainText("Plumber fixed the tank");
    for (const name of ["Resolve", "Comment", "Reopen"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
    // Cards still expand to what the PMs said.
    const card = concernCard(page, NEEDS_ATTENTION, "Hostel lights not working");
    await cardToggle(card).click();
    await expect(mentionLines(card)).toHaveCount(2);

    const res = await page.request.post("/api/visit-concerns/9004814/events", {
      data: { action: "resolve", body: "Trying anyway" },
    });
    expect(res.status()).toBe(403);
  });
});

// School page flags fixture: e2e/fixtures/migrations/20261027140600_seed_visit_summary_school_page_flags_fixture.sql
// (its header works out both Schools' sections). Flag 9004751 is the deep-link fixture's open flag on
// Aaditya Raj Dhawan, a roster Student at JNV Bundi (14061).
function flagSection(page: Page) {
  return page.getByRole("region", { name: "Intervention flags" });
}

function flagRows(page: Page) {
  return flagSection(page).getByRole("listitem");
}

test.describe("School Visit Summary — School page intervention flags", () => {
  test("lists the open flags below Needs attention and Going well, with the open and resolved counts", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary/schools/VSWPHYS");

    const sections = await adminPage.getByRole("region").evaluateAll((regions) =>
      regions.map((region) => document.getElementById(region.getAttribute("aria-labelledby") ?? "")?.textContent)
    );
    expect(sections.slice(sections.indexOf(NEEDS_ATTENTION), sections.indexOf(NEEDS_ATTENTION) + 3)).toEqual([
      NEEDS_ATTENTION,
      "Going well",
      "Intervention flags",
    ]);

    await expect(flagSection(adminPage).getByText("2 open · 1 resolved", { exact: true })).toBeVisible();
    await expect(flagRows(adminPage)).toHaveCount(2);
    // Initials only, with the full name on hover.
    await expect(flagRows(adminPage).nth(0)).toHaveText(
      "OpenV. F. S. T.G12 CoERaised by VSW Seated PM · 05 Oct 2026Notes in LMS ↗"
    );
    await expect(flagRows(adminPage).nth(0).getByText("V. F. S. T.")).toHaveAttribute("title", "VSW Flag Student Two");
    await expect(flagRows(adminPage).nth(1)).toHaveText(
      "OpenV. F. S. O.G11 CoERaised by e2e-vsw-pm@test.local · 05 Oct 2026Notes in LMS ↗"
    );
    await expect(flagSection(adminPage).locator('[title="VSW Flag Student Three"]')).toHaveCount(0);
  });

  test("never shows a JNV NVS flag at a mixed JNV, and counts a flag's updates when there are more than one", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary/schools/VSWMIXED");

    await expect(flagSection(adminPage).getByText("1 open", { exact: true })).toBeVisible();
    await expect(flagRows(adminPage)).toHaveText([
      "OpenV. F. S. T.G11 NodalRaised by e2e-vsw-pm@test.local · 06 Oct 2026" + "2 updates" + "Notes in LMS ↗",
    ]);
    await expect(flagRows(adminPage).nth(0).getByRole("link", { name: /Notes in LMS/ })).toHaveAttribute(
      "href",
      "/school/VSWMIXED?tab=enrollment&flag=9004755"
    );
    await expect(adminPage.locator('[title="VSW Flag Student Four"]')).toHaveCount(0);
  });

  test("a flag row's Notes in LMS opens the Student's flag on the School's Enrollment tab", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary/schools/14061");

    const notesLink = flagRows(adminPage)
      .filter({ has: adminPage.locator('[title="Aaditya Raj Dhawan"]') })
      .getByRole("link", { name: "Notes in LMS for A. R. D." });
    await expect(notesLink).toHaveAttribute("href", "/school/14061?tab=enrollment&flag=9004751");
    await notesLink.click();

    // The Enrollment tab consumes `flag` once it opens the modal, so the URL may already have dropped it.
    await expect(adminPage).toHaveURL(/\/school\/14061\?tab=enrollment/);
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Aaditya Raj Dhawan" })).toBeVisible();
    await expect(dialog.getByText("Missed two weeks after a family bereavement.")).toBeVisible();
  });
});

test.describe("Visit Concern storage", () => {
  test("concern history is append-only: a direct UPDATE or DELETE of an event fails", async () => {
    await withPool(async (pool) => {
      const { rows } = await pool.query<{ id: string }>(
        "SELECT id FROM lms_visit_concern_events ORDER BY id LIMIT 1"
      );
      expect(rows).toHaveLength(1);
      const eventId = rows[0].id;

      await expect(
        pool.query("UPDATE lms_visit_concern_events SET body = 'edited' WHERE id = $1", [eventId])
      ).rejects.toThrow(/append-only/);
      await expect(
        pool.query("DELETE FROM lms_visit_concern_events WHERE id = $1", [eventId])
      ).rejects.toThrow(/append-only/);
    });
  });
});
