import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth";

// Fixture: e2e/fixtures/migrations/20261027120000_seed_visit_summary_school_wise_fixture.sql.
// One completed Visit by FIXTURE_PM at each of four Schools; only VSWPHYS (physical-only) and
// VSWMIXED (physical + NVS Centres) have an active physical Centre, so only they are in view.
const FIXTURE_PM = "e2e-vsw-pm@test.local";
const PHYSICAL_SCHOOL = "VSW Physical School (VSWPHYS)";
const MIXED_SCHOOL = "VSW Mixed JNV (VSWMIXED)";
const NVS_ONLY_SCHOOL = "VSW NVS-only JNV (VSWNVS)";
const INACTIVE_CENTRE_SCHOOL = "VSW Inactive Centre School (VSWOFF)";

function statValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=following-sibling::div[1]");
}

function visitRows(page: Page) {
  return page.locator("table tbody tr");
}

function schoolOptions(page: Page) {
  return page.getByRole("group", { name: "School" }).locator("label");
}

test.describe("School Visit Summary — physical centres only", () => {
  test("lists, counts and offers only Schools with an active physical Centre", async ({ adminPage }) => {
    await adminPage.goto(`/school-visit-summary?pms=${FIXTURE_PM}`);

    await expect(visitRows(adminPage)).toHaveCount(2);
    await expect(visitRows(adminPage).filter({ hasText: PHYSICAL_SCHOOL })).toHaveCount(1);
    await expect(visitRows(adminPage).filter({ hasText: MIXED_SCHOOL })).toHaveCount(1);
    await expect(visitRows(adminPage).filter({ hasText: NVS_ONLY_SCHOOL })).toHaveCount(0);
    await expect(visitRows(adminPage).filter({ hasText: INACTIVE_CENTRE_SCHOOL })).toHaveCount(0);

    await expect(statValue(adminPage, "Total Visits")).toHaveText("2");
    await expect(statValue(adminPage, "In Progress")).toHaveText("0");
    await expect(statValue(adminPage, "Completed")).toHaveText("2");
    await expect(statValue(adminPage, "Unique Schools")).toHaveText("2");
    await expect(statValue(adminPage, "Unique PMs")).toHaveText("1");
    await expect(statValue(adminPage, "Avg Completion")).toHaveText("0%");

    // The School options keep the PM filter, so they are exactly the fixture PM's Schools in view.
    await expect(schoolOptions(adminPage)).toHaveText([MIXED_SCHOOL, PHYSICAL_SCHOOL]);
  });

  test("keeps NVS-only and inactive-Centre Schools out even when filtered for directly", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary?schools=VSWNVS,VSWOFF");

    await expect(adminPage.getByText("No visits match your filters")).toBeVisible();
    await expect(statValue(adminPage, "Total Visits")).toHaveText("0");
    await expect(statValue(adminPage, "Unique Schools")).toHaveText("0");

    // Unfiltered by School, the options never include them, and the fixture PM is still offered
    // only through their in-view Visits.
    await adminPage.goto("/school-visit-summary");
    await expect(schoolOptions(adminPage).filter({ hasText: PHYSICAL_SCHOOL })).toHaveCount(1);
    await expect(schoolOptions(adminPage).filter({ hasText: MIXED_SCHOOL })).toHaveCount(1);
    await expect(schoolOptions(adminPage).filter({ hasText: NVS_ONLY_SCHOOL })).toHaveCount(0);
    await expect(schoolOptions(adminPage).filter({ hasText: INACTIVE_CENTRE_SCHOOL })).toHaveCount(0);
  });

  test("drops the fixture PM from the PM options when only their out-of-view Visits match", async ({ adminPage }) => {
    await adminPage.goto("/school-visit-summary?schools=VSWNVS");

    await expect(adminPage.getByRole("group", { name: "PM" }).locator("label").filter({ hasText: FIXTURE_PM })).toHaveCount(0);
  });
});
