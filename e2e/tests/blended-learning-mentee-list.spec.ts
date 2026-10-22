import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import {
  BLENDED_MENTOR_A,
  MENTEES,
  OTHER_STUDENTS,
  fullName,
} from "../helpers/blended-learning-fixtures";

// Mentor A's Mentee list (#442) against the real fixture DDL, so the
// ownership, active-Mapping and current-year predicates run for real.
// Fixture facts (IST days before today): Ira — Conversation 10, Attempt 2;
// Kabir — nothing logged, a ready draft; Meera — Conversation 30;
// Nikhil — legacy month June 2026 only; Zoya — Conversation 29;
// Rohan — Conversation 3, a failed draft.
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 }, entryRole: "row" },
  { label: "mobile 360", viewport: { width: 360, height: 740 }, entryRole: "listitem" },
] as const;

const { attemptLatest, neverContacted, thirtyDays, legacy, twentyNineDays, recent } = MENTEES;

function group(page: Page, name: "Talk to First" | "Everyone else"): Locator {
  return page.getByRole("region", { name, exact: true });
}

for (const { label, viewport, entryRole } of VIEWPORTS) {
  test.describe(`Blended Learning Mentee list — ${label}`, () => {
    test.use({ viewport });

    function entries(section: Locator): Locator {
      // A table row with cells on desktop (not the header row); a card below 640 px.
      const all = section.getByRole(entryRole);
      return entryRole === "row" ? all.filter({ has: section.page().getByRole("cell") }) : all;
    }

    function entry(section: Locator, mentee: { firstName: string; lastName: string }): Locator {
      return entries(section).filter({ hasText: fullName(mentee) });
    }

    test.beforeEach(async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto("/blended-learning");
    });

    test("a Mentor sees exactly their own active current-year Mentees", async ({ page }) => {
      await expect(entries(group(page, "Talk to First"))).toHaveCount(4);
      await expect(entries(group(page, "Everyone else"))).toHaveCount(2);

      for (const other of Object.values(OTHER_STUDENTS)) {
        await expect(page.getByText(fullName(other))).toHaveCount(0);
      }
    });

    test("Talk to First is in priority order with Why now tags", async ({ page }) => {
      const talkToFirst = group(page, "Talk to First");

      await expect(entries(talkToFirst)).toHaveText([
        new RegExp(fullName(attemptLatest)),
        new RegExp(fullName(neverContacted)),
        new RegExp(fullName(legacy)),
        new RegExp(fullName(thirtyDays)),
      ]);
      await expect(talkToFirst.getByText("4", { exact: true })).toBeVisible();

      const ira = entry(talkToFirst, attemptLatest);
      await expect(ira.getByText("Last try didn't connect")).toBeVisible();
      // The Attempt 2 days ago never counts as Last Contact.
      await expect(ira.getByText("10 days ago")).toBeVisible();

      const kabir = entry(talkToFirst, neverContacted);
      await expect(kabir.getByText("Never reached")).toBeVisible();
      await expect(kabir.getByText("No contact yet")).toBeVisible();

      const nikhil = entry(talkToFirst, legacy);
      await expect(nikhil.getByText("30+ days")).toBeVisible();
      await expect(nikhil.getByText("Jun 2026 · before app")).toBeVisible();

      const meera = entry(talkToFirst, thirtyDays);
      await expect(meera.getByText("30+ days")).toBeVisible();
      await expect(meera.getByText("30 days ago")).toBeVisible();
    });

    test("Everyone else holds the 29-day and this-week Mentees, larger gap first", async ({ page }) => {
      const everyoneElse = group(page, "Everyone else");

      await expect(entries(everyoneElse)).toHaveText([
        new RegExp(fullName(twentyNineDays)),
        new RegExp(fullName(recent)),
      ]);
      await expect(entry(everyoneElse, twentyNineDays).getByText("29 days ago")).toBeVisible();
      await expect(entry(everyoneElse, recent).getByText("3 days ago")).toBeVisible();
    });

    test("a ready draft shows its chip without changing the group or Last Contact", async ({ page }) => {
      const kabir = entry(group(page, "Talk to First"), neverContacted);
      await expect(kabir.getByText("Draft ready to review")).toBeVisible();
      await expect(kabir.getByText("No contact yet")).toBeVisible();

      // Rohan's failed draft is not ready, so no chip.
      await expect(entry(group(page, "Everyone else"), recent).getByText("Draft ready to review")).toHaveCount(0);
    });

    test("shows each Mentee's grade, program and gender", async ({ page }) => {
      const ira = entry(group(page, "Talk to First"), attemptLatest);
      await expect(ira.getByText("Grade 12")).toBeVisible();
      await expect(ira.getByText("STP Voucher Delhi")).toBeVisible();
      await expect(ira.getByText("Female")).toBeVisible();

      const kabir = entry(group(page, "Talk to First"), neverContacted);
      await expect(kabir.getByText("Grade 13")).toBeVisible();
      await expect(kabir.getByText("STP Dropper Delhi")).toBeVisible();
    });

    if (entryRole === "listitem") {
      test("renders cards with no horizontal page scroll and 44 px tap targets", async ({ page }) => {
        await expect(entries(group(page, "Talk to First")).first()).toBeVisible();
        await expect(page.getByRole("table")).toHaveCount(0);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);

        const links = page.getByRole("main").getByRole("link");
        await expect(links).toHaveCount(6);
        for (const link of await links.all()) {
          const box = await link.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        }
      });
    } else {
      test("renders a table on desktop", async ({ page }) => {
        await expect(group(page, "Talk to First").getByRole("table")).toBeVisible();
        await expect(group(page, "Talk to First").getByRole("columnheader", { name: "Last Contact" })).toBeVisible();
      });
    }
  });
}
