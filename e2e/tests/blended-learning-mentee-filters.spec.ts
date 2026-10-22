import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { BLENDED_MENTOR_A, MENTEES, fullName } from "../helpers/blended-learning-fixtures";

// Search and filters on Mentor A's Mentee list (#443). Expected rows come
// from the hand-written fixture facts in blended-learning-fixtures.ts:
//   Ira Attempt       Female  Grade 12  STP Voucher Delhi             Talk to First (Last Contact 10 days)
//   Kabir Never       Male    Grade 13  STP Dropper Delhi             Talk to First (no Last Contact)
//   Meera Thirty      Female  Grade 12  STP Voucher Punjab            Talk to First (30 days)
//   Nikhil Legacy     Male    Grade 13  STP Dropper Punjab            Talk to First (legacy June 2026)
//   Zoya TwentyNine   Female  Grade 12  STP Voucher Himachal Pradesh  Everyone else (29 days)
//   Rohan Recent      Male    Grade 12  STP Voucher Uttarakhand       Everyone else (3 days)
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 }, entryRole: "row" },
  { label: "mobile 360", viewport: { width: 360, height: 740 }, entryRole: "listitem" },
] as const;

const { attemptLatest, neverContacted, thirtyDays, legacy, twentyNineDays, recent } = MENTEES;

function group(page: Page, name: "Talk to First" | "Everyone else"): Locator {
  return page.getByRole("region", { name, exact: true });
}

function names(...mentees: { firstName: string; lastName: string }[]): RegExp[] {
  return mentees.map((mentee) => new RegExp(fullName(mentee)));
}

for (const { label, viewport, entryRole } of VIEWPORTS) {
  test.describe(`Blended Learning Mentee search and filters — ${label}`, () => {
    test.use({ viewport });

    function entries(section: Locator): Locator {
      const all = section.getByRole(entryRole);
      return entryRole === "row" ? all.filter({ has: section.page().getByRole("cell") }) : all;
    }

    test.beforeEach(async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto("/blended-learning");
      await expect(entries(group(page, "Talk to First"))).toHaveCount(4);
    });

    test("name search narrows both groups, ignoring case", async ({ page }) => {
      await page.getByRole("searchbox", { name: "Search by name" }).fill("Y");

      await expect(entries(group(page, "Talk to First"))).toHaveText(names(legacy, thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays));
    });

    test("gender filter narrows both groups", async ({ page }) => {
      await page.getByRole("combobox", { name: "Gender" }).selectOption("Male");

      await expect(entries(group(page, "Talk to First"))).toHaveText(names(neverContacted, legacy));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(recent));
    });

    test("grade filter narrows both groups", async ({ page }) => {
      await page.getByRole("combobox", { name: "Grade" }).selectOption("Grade 13");

      await expect(entries(group(page, "Talk to First"))).toHaveText(names(neverContacted, legacy));
      await expect(entries(group(page, "Everyone else"))).toHaveCount(0);
      await expect(group(page, "Everyone else").getByText("No one here matches your filters.")).toBeVisible();

      await page.getByRole("combobox", { name: "Grade" }).selectOption("Grade 12");

      await expect(entries(group(page, "Talk to First"))).toHaveText(names(attemptLatest, thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays, recent));
    });

    test("program filter narrows both groups", async ({ page }) => {
      const program = page.getByRole("combobox", { name: "Program" });
      await program.selectOption("STP Voucher Uttarakhand");

      await expect(entries(group(page, "Talk to First"))).toHaveCount(0);
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(recent));

      await program.selectOption("STP Dropper Punjab");

      await expect(entries(group(page, "Talk to First"))).toHaveText(names(legacy));
      await expect(entries(group(page, "Everyone else"))).toHaveCount(0);
    });

    test("30 days or more includes no Last Contact and legacy months, but not 29 days", async ({ page }) => {
      await page.getByRole("checkbox", { name: "30 days or more" }).check();

      // Ira's Last Contact is 10 days ago (her Attempt is not contact); Zoya's is 29.
      await expect(entries(group(page, "Talk to First"))).toHaveText(
        names(neverContacted, legacy, thirtyDays)
      );
      await expect(entries(group(page, "Everyone else"))).toHaveCount(0);
    });

    test("filters combine", async ({ page }) => {
      await page.getByRole("combobox", { name: "Gender" }).selectOption("Female");
      await page.getByRole("combobox", { name: "Grade" }).selectOption("Grade 12");

      await expect(entries(group(page, "Talk to First"))).toHaveText(names(attemptLatest, thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays));

      await page.getByRole("checkbox", { name: "30 days or more" }).check();

      await expect(entries(group(page, "Talk to First"))).toHaveText(names(thirtyDays));
      await expect(entries(group(page, "Everyone else"))).toHaveCount(0);
    });

    test("an empty result shows an empty state, and Clear filters restores the full grouped list", async ({ page }) => {
      await page.getByRole("combobox", { name: "Grade" }).selectOption("Grade 13");
      await page.getByRole("searchbox", { name: "Search by name" }).fill("zoya");

      await expect(page.getByText("No Mentees match your search and filters.")).toBeVisible();
      await expect(group(page, "Talk to First")).toHaveCount(0);
      await expect(group(page, "Everyone else")).toHaveCount(0);

      await page.getByRole("button", { name: "Clear filters" }).click();

      await expect(page.getByRole("searchbox", { name: "Search by name" })).toHaveValue("");
      await expect(page.getByRole("combobox", { name: "Grade" })).toHaveValue("");
      await expect(entries(group(page, "Talk to First"))).toHaveText(
        names(attemptLatest, neverContacted, legacy, thirtyDays)
      );
      await expect(entries(group(page, "Everyone else"))).toHaveText(names(twentyNineDays, recent));
    });

    if (label === "mobile 360") {
      test("every control fits the 360 px width as a 44 px tap target, with no horizontal page scroll", async ({ page }) => {
        // Long program names must not widen the page.
        await page.getByRole("combobox", { name: "Program" }).selectOption("STP Voucher Himachal Pradesh");
        await page.getByRole("checkbox", { name: "30 days or more" }).check();

        const controls = [
          page.getByRole("searchbox", { name: "Search by name" }),
          page.getByRole("combobox", { name: "Gender" }),
          page.getByRole("combobox", { name: "Grade" }),
          page.getByRole("combobox", { name: "Program" }),
          // The label is the tap target for the checkbox.
          page.locator("label").filter({ hasText: "30 days or more" }),
          page.getByRole("button", { name: "Clear filters" }),
        ];
        for (const control of controls) {
          await expect(control).toBeVisible();
          const box = await control.boundingBox();
          expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
          expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
