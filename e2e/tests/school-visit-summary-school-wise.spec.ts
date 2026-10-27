import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth";

// Fixture: e2e/fixtures/migrations/20261027120000_seed_visit_summary_school_wise_fixture.sql.
// One completed Visit by FIXTURE_PM at each of five Schools; only VSWPHYS (physical-only),
// VSWMIXED (physical + NVS Centres) and VSWNOREG (no region) have an active physical Centre, so
// only they are in view. VSWPHYS and VSWMIXED are in region VSW_E2E.
const FIXTURE_PM = "e2e-vsw-pm@test.local";
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

test.describe("School Visit Summary — physical centres only", () => {
  test("lists, counts and offers only Schools with an active physical Centre", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}`);

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
    await adminPage.goto("/school-visit-summary?schools=VSWNVS,VSWOFF");

    await expect(adminPage.getByText("No visits match your filters")).toBeVisible();
    await expect(statValue(adminPage, "Total Visits")).toHaveText("0");
    await expect(statValue(adminPage, "Unique Schools")).toHaveText("0");

    // Unfiltered by School, the options never include them, and the fixture PM is still offered
    // only through their in-view Visits.
    await adminPage.goto("/school-visit-summary");
    const schoolOptions = await optionNames(adminPage, "School");
    await expect(schoolOptions.filter({ hasText: PHYSICAL_SCHOOL })).toHaveCount(1);
    await expect(schoolOptions.filter({ hasText: MIXED_SCHOOL })).toHaveCount(1);
    await expect(schoolOptions.filter({ hasText: NVS_ONLY_SCHOOL })).toHaveCount(0);
    await expect(schoolOptions.filter({ hasText: INACTIVE_CENTRE_SCHOOL })).toHaveCount(0);
  });

  test("drops the fixture PM from the PM options when only their out-of-view Visits match", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary?schools=VSWNVS");

    await expect((await optionNames(adminPage, "PM")).filter({ hasText: FIXTURE_PM })).toHaveCount(0);
  });
});

test.describe("School Visit Summary — Region, School and PM filters", () => {
  test("offers the Regions in view and filters to Schools with no region", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}`);
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
    await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}`);

    await openOptions(adminPage, "Region");
    await filter(adminPage, "Region").getByRole("checkbox", { name: "VSW_E2E" }).check();
    await expect(adminPage).toHaveURL(/[?&]regions=VSW_E2E(&|$)/);
    await expect(visitRows(adminPage)).toHaveCount(2);

    await expect(await optionNames(adminPage, "School")).toHaveText([MIXED_SCHOOL, PHYSICAL_SCHOOL]);
  });

  test("searches School options and lists the ticked School first", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}&schools=VSWPHYS`);
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
    await adminPage.goto("/school-visit-summary?regions=NOT_A_REGION");

    await expect(adminPage.getByText("No visits match your filters")).toBeVisible();
    await expect(statValue(adminPage, "Total Visits")).toHaveText("0");
    await expect(filter(adminPage, "Region").getByRole("button")).toHaveText("NOT_A_REGION (not in results)");
  });
});
