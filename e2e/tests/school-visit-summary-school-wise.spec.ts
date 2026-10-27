import type { Page } from "@playwright/test";
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

function statValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=following-sibling::div[1]");
}

function visitRows(page: Page) {
  return page.locator("table tbody tr");
}

function schoolRows(page: Page) {
  return page.getByRole("table", { name: "Schools with visits" }).locator("tbody tr");
}

// The School, Visits, Last visit, Recurring issues and Top recurring concern cells of each
// School-wise row, top to bottom.
function schoolColumn(page: Page, column: 0 | 1 | 2 | 3 | 4) {
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

    await expect(statValue(adminPage, "Total Visits")).toHaveText("3");
    await expect(statValue(adminPage, "In Progress")).toHaveText("0");
    await expect(statValue(adminPage, "Completed")).toHaveText("3");
    await expect(statValue(adminPage, "Unique Schools")).toHaveText("3");
    await expect(statValue(adminPage, "Unique PMs")).toHaveText("1");
    await expect(statValue(adminPage, "Avg Completion")).toHaveText("0%");

    // The School options keep the PM filter, so they are exactly the fixture PM's Schools in view.
    await expect(await optionNames(adminPage, "School")).toHaveText([MIXED_SCHOOL, NO_REGION_SCHOOL, PHYSICAL_SCHOOL]);
  });

  test("keeps NVS-only and inactive-Centre Schools out even when filtered for directly", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary?tab=visits&schools=VSWNVS,VSWOFF");

    await expect(adminPage.getByText("No visits match your filters")).toBeVisible();
    await expect(statValue(adminPage, "Total Visits")).toHaveText("0");
    await expect(statValue(adminPage, "Unique Schools")).toHaveText("0");

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
    await expect(adminPage).toHaveURL(/[?&]page=1(&|$)/);

    await expect(visitRows(adminPage)).toHaveCount(1);
    await expect(visitRows(adminPage).filter({ hasText: NO_REGION_SCHOOL })).toHaveCount(1);
    await expect(statValue(adminPage, "Total Visits")).toHaveText("1");
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
    await expect(statValue(adminPage, "Total Visits")).toHaveText("0");
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
      `${MIXED} (VSW_E2E)`,
      NO_REGION_NAME,
      `${OLD} (VSW_E2E)`,
      `${PHYSICAL} (VSW_E2E)`,
    ]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["1", "1", "2", "3"]);
    await expect(schoolRow(adminPage, MIXED)).toContainText("06 Oct 2026");
    await expect(schoolRow(adminPage, NO_REGION_NAME)).toContainText("09 Oct 2026");
    await expect(schoolRow(adminPage, OLD)).toContainText("01 Aug 2025");

    await expect(statValue(adminPage, "Schools")).toHaveText("4");
    await expect(statValue(adminPage, "Visits")).toHaveText("7");
    await expect(adminPage.getByText("Total Visits", { exact: true })).toHaveCount(0);
  });

  test("flags a Last visit more than 45 days ago as stale", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}`);

    await expect(schoolRow(adminPage, OLD).getByText("Stale", { exact: true })).toBeVisible();
    await expect(schoolRow(adminPage, PHYSICAL).getByText("Stale", { exact: true })).toHaveCount(0);
  });

  test("Visits and Last visit follow the PM, status, date and required-actions filters", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} (VSW_E2E)`, NO_REGION_NAME, `${PHYSICAL} (VSW_E2E)`]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["1", "1", "1"]);
    await expect(schoolRow(adminPage, PHYSICAL)).toContainText("05 Oct 2026");

    await adminPage.goto(`/school-visit-summary?pms=${SECOND_PM}&status=completed`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${OLD} (VSW_E2E)`, `${PHYSICAL} (VSW_E2E)`]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["2", "1"]);

    await adminPage.goto(`/school-visit-summary?pms=${SECOND_PM}&status=in_progress`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${PHYSICAL} (VSW_E2E)`]);
    await expect(schoolRow(adminPage, PHYSICAL)).toContainText("01 Sept 2026");

    await adminPage.goto(`/school-visit-summary?pms=${SECOND_PM}&from=2025-07-20&to=2025-12-31`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${OLD} (VSW_E2E)`]);
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
      `${PHYSICAL} (VSW_E2E)`, `${OLD} (VSW_E2E)`, `${MIXED} (VSW_E2E)`, NO_REGION_NAME,
    ]);

    await sortHeader(adminPage, "Visits").click();
    await expect(adminPage).toHaveURL(/[?&]sort=visits&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${MIXED} (VSW_E2E)`, NO_REGION_NAME, `${OLD} (VSW_E2E)`, `${PHYSICAL} (VSW_E2E)`,
    ]);

    await sortHeader(adminPage, "Last visit").click();
    await expect(adminPage).toHaveURL(/[?&]sort=last_visit&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${PHYSICAL} (VSW_E2E)`, NO_REGION_NAME, `${MIXED} (VSW_E2E)`, `${OLD} (VSW_E2E)`,
    ]);

    await sortHeader(adminPage, "Last visit").click();
    await expect(adminPage).toHaveURL(/[?&]sort=last_visit&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${OLD} (VSW_E2E)`, `${MIXED} (VSW_E2E)`, NO_REGION_NAME, `${PHYSICAL} (VSW_E2E)`,
    ]);

    await sortHeader(adminPage, /School \(region\)/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=school_name&dir=asc(&|$)/);
    await sortHeader(adminPage, /School \(region\)/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=school_name&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${PHYSICAL} (VSW_E2E)`, `${OLD} (VSW_E2E)`, NO_REGION_NAME, `${MIXED} (VSW_E2E)`,
    ]);
  });

  test("ignores the other tab's sort key", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${BOTH_PMS}&sort=completed_at&dir=asc`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${MIXED} (VSW_E2E)`, NO_REGION_NAME, `${OLD} (VSW_E2E)`, `${PHYSICAL} (VSW_E2E)`,
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
    await expect(statValue(adminPage, "Total Visits")).toHaveText("2");

    await adminPage.goto(`${visitsUrl.pathname}${visitsUrl.search}&sort=school_name&dir=desc&page=1`);
    await tab(adminPage, "School-wise").click();
    await expect(adminPage).toHaveURL(/[?&]tab=schools(&|$)/);
    expect(Object.fromEntries(new URL(adminPage.url()).searchParams)).toEqual({
      tab: "schools",
      regions: "VSW_E2E",
      pms: FIXTURE_PM,
      status: "completed",
    });
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} (VSW_E2E)`, `${PHYSICAL} (VSW_E2E)`]);
  });

  test("a PM with a pm seat sees only their visit-managed physical-centre Schools", async ({ page }) => {
    await signInAs(page, SEATED_PM);
    await page.goto("/school-visit-summary");

    // Seated at VSWPHYS and at NVS-only VSWNVS: only VSWPHYS shows, with every PM's Visits there.
    await expect(schoolColumn(page, 0)).toHaveText([`${PHYSICAL} (VSW_E2E)`]);
    await expect(schoolColumn(page, 1)).toHaveText(["3"]);
    await expect(statValue(page, "Schools")).toHaveText("1");
    await expect(statValue(page, "Visits")).toHaveText("3");
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

test.describe("School Visit Summary — Recurring Concerns on the School-wise tab", () => {
  test("counts Recurring and open Concerns per School, most recurring first", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);

    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${ALPHA} (VSW_E2E)`, `${BRAVO} (VSW_E2E)`, `${CHARLIE} (VSW_E2E)`, `${DELTA} (VSW_E2E)`,
    ]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["5", "3", "1", "1"]);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["3", "1", "0", "0"]);

    await expect(statValue(adminPage, "Schools")).toHaveText("4");
    await expect(statValue(adminPage, "Visits")).toHaveText("10");
    await expect(statValue(adminPage, "Schools with recurring concerns")).toHaveText("2");
    await expect(statValue(adminPage, "Open concerns")).toHaveText("7");

    // Alpha's three 2-visit concerns tie; the 15 Sep ones beat the 06 Aug one, then the lower id wins.
    await expect(schoolColumn(adminPage, 4).nth(0)).toHaveText(`${HTML_CONCERN}2 visits`);
    await expect(schoolColumn(adminPage, 4).nth(1)).toHaveText("Smartboard not working3 visits");
    await expect(schoolColumn(adminPage, 4).nth(2)).toHaveText("—");
    await expect(schoolColumn(adminPage, 4).nth(3)).toHaveText("—");

    await expect(schoolRow(adminPage, ALPHA).getByRole("img", { name: "3 or more recurring concerns" })).toBeVisible();
    await expect(schoolRow(adminPage, BRAVO).getByRole("img", { name: "1–2 recurring concerns" })).toBeVisible();
    await expect(schoolRow(adminPage, CHARLIE).getByRole("img", { name: "Open concerns, none recurring" })).toBeVisible();
    await expect(schoolRow(adminPage, DELTA).getByRole("img", { name: "No open concerns" })).toBeVisible();
  });

  test("counts only Visits in view: dates and PMs change Recurring counts", async ({ adminPage }) => {
    // August only: Alpha's two same-day Visits are two mentions of "Lab equipment missing".
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&from=2026-08-01&to=2026-08-31`);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${ALPHA} (VSW_E2E)`, `${BRAVO} (VSW_E2E)`]);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["2", "1"]);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["1", "0"]);
    await expect(schoolColumn(adminPage, 4).nth(0)).toHaveText("Lab equipment missing2 visits");
    await expect(statValue(adminPage, "Schools with recurring concerns")).toHaveText("1");
    await expect(statValue(adminPage, "Open concerns")).toHaveText("2");

    // Alpha over every Visit: the resolved concern, the highlight and the concern mentioned only
    // in the soft-deleted Visit don't count.
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&schools=VSWCONA`);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["3"]);
    await expect(statValue(adminPage, "Open concerns")).toHaveText("4");

    // From September: the soft-deleted Visit's mention doesn't make "Timetable clashes" recur.
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}&schools=VSWCONA&from=2026-09-01`);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["0"]);
    await expect(statValue(adminPage, "Open concerns")).toHaveText("3");
    await expect(schoolRow(adminPage, ALPHA).getByRole("img", { name: "Open concerns, none recurring" })).toBeVisible();

    // Adding the second PM's Visit makes "Library closed" recur at Bravo; the 3-visit concern stays top.
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM},${CONCERN_PM_2}&schools=VSWCONB`);
    await expect(schoolColumn(adminPage, 1)).toHaveText(["4"]);
    await expect(schoolColumn(adminPage, 3)).toHaveText(["2"]);
    await expect(schoolColumn(adminPage, 4)).toHaveText(["Smartboard not working3 visits"]);
  });

  test("sorts by Recurring issues both ways, ties by School name; Top recurring concern isn't sortable", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);
    await expect(sortHeader(adminPage, /Top recurring concern/)).toHaveCount(0);

    await sortHeader(adminPage, /Recurring issues/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=recurring&dir=asc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${CHARLIE} (VSW_E2E)`, `${DELTA} (VSW_E2E)`, `${BRAVO} (VSW_E2E)`, `${ALPHA} (VSW_E2E)`,
    ]);

    await sortHeader(adminPage, /Recurring issues/).click();
    await expect(adminPage).toHaveURL(/[?&]sort=recurring&dir=desc(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([
      `${ALPHA} (VSW_E2E)`, `${BRAVO} (VSW_E2E)`, `${CHARLIE} (VSW_E2E)`, `${DELTA} (VSW_E2E)`,
    ]);
  });

  test("Recurring concerns only keeps Schools with a Recurring Concern, and the Visits tab link keeps it", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${CONCERN_PM}`);

    await adminPage.getByRole("checkbox", { name: "Recurring concerns only" }).check();
    await expect(adminPage).toHaveURL(/[?&]recurring=1(&|$)/);
    await expect(schoolColumn(adminPage, 0)).toHaveText([`${ALPHA} (VSW_E2E)`, `${BRAVO} (VSW_E2E)`]);
    await expect(statValue(adminPage, "Schools")).toHaveText("2");
    await expect(statValue(adminPage, "Visits")).toHaveText("8");
    await expect(statValue(adminPage, "Schools with recurring concerns")).toHaveText("2");
    await expect(statValue(adminPage, "Open concerns")).toHaveText("6");
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
        await expect(schoolColumn(adminPage, 0)).toHaveText([`${MIXED} (VSW_E2E)`, NO_REGION_NAME, `${PHYSICAL} (VSW_E2E)`]);
        await expect(schoolColumn(adminPage, 3)).toHaveText(["0", "0", "0"]);
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
