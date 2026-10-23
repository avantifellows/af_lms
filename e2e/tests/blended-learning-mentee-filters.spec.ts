import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { BLENDED_MENTOR_A, MENTEES, fullName } from "../helpers/blended-learning-fixtures";

// Search and filters on Mentor A's Student list (#443). Expected rows come
// from the hand-written fixture facts in blended-learning-fixtures.ts:
//   Ira Attempt       Female  Grade 12  STP Voucher Delhi             Talk to first (Last Contact 10 days)
//   Kabir Never       Male    Grade 13  STP Dropper Delhi             Talk to first (no Last Contact)
//   Meera Thirty      Female  Grade 12  STP Voucher Punjab            Talk to first (30 days)
//   Nikhil Legacy     Male    Grade 13  STP Dropper Punjab            Talk to first (legacy date 14 Jun 2026)
//   Zoya TwentyNine   Female  Grade 12  STP Voucher Himachal Pradesh  Everyone else (29 days)
//   Rohan Recent      Male    Grade 12  STP Voucher Uttarakhand       Everyone else (3 days)
// From 1024 px up each group is a named rowgroup of one table; below that, a
// region of cards. A group with no matching Students is left out.
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 }, desktop: true },
  { label: "mobile 360", viewport: { width: 360, height: 740 }, desktop: false },
] as const;

const { attemptLatest, neverContacted, thirtyDays, legacy, twentyNineDays, recent } = MENTEES;

// Visible, inside the 360 px viewport, and at least 44 px tall.
async function expectTapTargetWithin360(control: Locator) {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const { x, width, height } = box!;
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x + width).toBeLessThanOrEqual(360);
  expect(height).toBeGreaterThanOrEqual(44);
}

function names(...mentees: { firstName: string; lastName: string }[]): RegExp[] {
  return mentees.map((mentee) => new RegExp(fullName(mentee)));
}

for (const { label, viewport, desktop } of VIEWPORTS) {
  test.describe(`Blended Learning Student search and filters — ${label}`, () => {
    test.use({ viewport });

    function group(page: Page, name: "Talk to first" | "Everyone else"): Locator {
      return page.getByRole(desktop ? "rowgroup" : "region", { name, exact: true });
    }

    function entries(section: Locator): Locator {
      if (!desktop) return section.getByRole("listitem");
      return section.getByRole("row").filter({ has: section.page().getByRole("cell") });
    }

    test.beforeEach(async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto("/blended-learning");
      await expect(entries(group(page, "Talk to first"))).toHaveCount(4);
    });

    test("name search narrows both groups, ignoring case", async ({ page }) => {
      await page.getByRole("searchbox", { name: "Search by name" }).fill("Y");

      await expect(entries(group(page, "Talk to first"))).toHaveText(names(legacy, thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays));
    });

    test("gender filter narrows both groups", async ({ page }) => {
      await page.getByRole("combobox", { name: "Gender" }).selectOption("Male");

      await expect(entries(group(page, "Talk to first"))).toHaveText(names(neverContacted, legacy));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(recent));
    });

    test("grade filter narrows both groups", async ({ page }) => {
      await page.getByRole("combobox", { name: "Grade" }).selectOption("13");

      await expect(entries(group(page, "Talk to first"))).toHaveText(names(neverContacted, legacy));
      await expect(group(page, "Talk to first")).toContainText("2 of 2.");
      // Everyone else has no Grade 13 Student, so the group is left out.
      await expect(group(page, "Everyone else")).toHaveCount(0);

      await page.getByRole("combobox", { name: "Grade" }).selectOption("12");

      await expect(entries(group(page, "Talk to first"))).toHaveText(names(attemptLatest, thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays, recent));
    });

    test("program filter narrows both groups", async ({ page }) => {
      const program = page.getByRole("combobox", { name: "Program" });
      await program.selectOption("STP Voucher Uttarakhand");

      await expect(entries(group(page, "Talk to first"))).toHaveCount(0);
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(recent));

      await program.selectOption("STP Dropper Punjab");

      await expect(entries(group(page, "Talk to first"))).toHaveText(names(legacy));
      await expect(entries(group(page, "Everyone else"))).toHaveCount(0);
    });

    test("Last contact: 30 days or more includes no Last Contact and old legacy dates, but not 29 days", async ({ page }) => {
      const lastContact = page.getByRole("combobox", { name: "Last contact" });
      await expect(lastContact).toHaveValue("");
      await lastContact.selectOption("30 days or more");

      // Ira's Last Contact is 10 days ago (her Attempt is not contact); Zoya's is 29.
      await expect(entries(group(page, "Talk to first"))).toHaveText(
        names(neverContacted, legacy, thirtyDays)
      );
      await expect(entries(group(page, "Everyone else"))).toHaveCount(0);
    });

    test("filters combine", async ({ page }) => {
      await page.getByRole("combobox", { name: "Gender" }).selectOption("Female");
      await page.getByRole("combobox", { name: "Grade" }).selectOption("12");

      await expect(entries(group(page, "Talk to first"))).toHaveText(names(attemptLatest, thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays));

      await page.getByRole("combobox", { name: "Last contact" }).selectOption("30 days or more");

      await expect(entries(group(page, "Talk to first"))).toHaveText(names(thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveCount(0);
    });

    test("an empty result shows an empty state, and Clear filters restores the full grouped list", async ({ page }) => {
      await page.getByRole("combobox", { name: "Grade" }).selectOption("13");
      await page.getByRole("searchbox", { name: "Search by name" }).fill("zoya");

      await expect(page.getByText("No students match these filters.")).toBeVisible();
      await expect(group(page, "Talk to first")).toHaveCount(0);
      await expect(group(page, "Everyone else")).toHaveCount(0);

      await page.getByRole("button", { name: "Clear filters" }).click();

      await expect(page.getByRole("searchbox", { name: "Search by name" })).toHaveValue("");
      await expect(page.getByRole("combobox", { name: "Grade" })).toHaveValue("");
      await expect(entries(group(page, "Talk to first"))).toHaveText(
        names(attemptLatest, neverContacted, legacy, thirtyDays)
      );
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays, recent));
    });

    if (label === "mobile 360") {
      test("every control fits the 360 px width as a 44 px tap target, with no horizontal page scroll", async ({ page }) => {
        // Long program names must not widen the page.
        await page.getByRole("combobox", { name: "Program" }).selectOption("STP Voucher Himachal Pradesh");
        await page.getByRole("combobox", { name: "Last contact" }).selectOption("30 days or more");

        const controls = [
          page.getByRole("searchbox", { name: "Search by name" }),
          page.getByRole("combobox", { name: "Gender" }),
          page.getByRole("combobox", { name: "Grade" }),
          page.getByRole("combobox", { name: "Program" }),
          page.getByRole("combobox", { name: "Last contact" }),
          page.getByRole("button", { name: "Clear filters" }),
        ];
        for (const control of controls) await expectTapTargetWithin360(control);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
