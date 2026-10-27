import { test, expect } from "../fixtures/auth";

// Fixture: e2e/fixtures/migrations/20261027130100_seed_intervention_flag_deep_link_fixture.sql.
// Flag 9004751 is open on Aaditya Raj Dhawan, a JNV CoE Student at JNV Bundi (14061), a School
// with an active physical Centre.
const SCHOOL_CODE = "14061";
const FLAG_ID = 9004751;

test.describe("Intervention flag deep link (?flag=<id>)", () => {
  test("opens the flagged Student's dialog on the Enrollment tab", async ({ adminPage }) => {
    await adminPage.goto(`/school/${SCHOOL_CODE}?tab=enrollment&flag=${FLAG_ID}`);

    const dialog = adminPage.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Aaditya Raj Dhawan" })).toBeVisible();
    await expect(dialog.getByText("Missed two weeks after a family bereavement.")).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(adminPage.getByRole("dialog")).toHaveCount(0);
    await expect(adminPage.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");
  });

  test("ignores an unknown flag id", async ({ adminPage }) => {
    const flagsLoaded = adminPage.waitForResponse(
      (response) => response.url().endsWith(`/api/schools/${SCHOOL_CODE}/intervention-flags`) && response.ok(),
    );
    await adminPage.goto(`/school/${SCHOOL_CODE}?tab=enrollment&flag=999999999`);
    await flagsLoaded;

    await expect(adminPage.getByRole("tab", { name: "Enrollment" })).toHaveAttribute("aria-selected", "true");
    await expect(adminPage.getByLabel(/Needs intervention only/)).toBeVisible();
    await expect(adminPage.getByRole("dialog")).toHaveCount(0);
  });
});
