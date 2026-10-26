import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import {
  BLENDED_MENTOR_A,
  MENTEES,
  OTHER_STUDENTS,
  fullName,
} from "../helpers/blended-learning-fixtures";
import { shortDate } from "../../src/app/blended-learning/menteeListCopy";

// Mentor A's Student list (#442) against the real fixture DDL, so the
// ownership, active-Mapping and current-year predicates run for real.
// Fixture facts (IST days before today): Ira — Conversation 10 (25 min),
// Attempt 2; Kabir — nothing logged, a ready draft; Meera — Conversation 30;
// Nikhil — legacy last-contact date 14 Jun 2026 only; Zoya — Conversation 29;
// Rohan — Conversation 3, a failed draft.
//
// From 1024 px up the list is one table, each group a named rowgroup with a
// header row; below that each group is a region of cards.
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 }, desktop: true },
  { label: "mobile 360", viewport: { width: 360, height: 740 }, desktop: false },
] as const;

const { attemptLatest, neverContacted, thirtyDays, legacy, twentyNineDays, recent } = MENTEES;

type GroupName = "Talk to first" | "Everyone else";

// The IST calendar date `days` before today, as YYYY-MM-DD.
function istDaysAgo(days: number): string {
  const istNow = new Date(Date.now() + 330 * 60 * 1000);
  istNow.setUTCDate(istNow.getUTCDate() - days);
  return istNow.toISOString().slice(0, 10);
}

for (const { label, viewport, desktop } of VIEWPORTS) {
  test.describe(`Blended Learning Student list — ${label}`, () => {
    test.use({ viewport });

    function group(page: Page, name: GroupName): Locator {
      return page.getByRole(desktop ? "rowgroup" : "region", { name, exact: true });
    }

    function entries(section: Locator): Locator {
      // A table row with cells (not the group's header row), or a card.
      if (!desktop) return section.getByRole("listitem");
      return section.getByRole("row").filter({ has: section.page().getByRole("cell") });
    }

    function entry(section: Locator, mentee: { firstName: string; lastName: string }): Locator {
      return entries(section).filter({ hasText: fullName(mentee) });
    }

    test.beforeEach(async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto("/blended-learning");
    });

    test("a Mentor sees exactly their own active current-year Students under the My Students tab", async ({ page }) => {
      await expect(page.getByRole("heading", { level: 1, name: "My Students" })).toBeAttached();
      await expect(page.getByText(/^6 students · \d{4}-\d{4}$/)).toBeVisible();
      await expect(entries(group(page, "Talk to first"))).toHaveCount(4);
      await expect(entries(group(page, "Everyone else"))).toHaveCount(2);

      for (const other of Object.values(OTHER_STUDENTS)) {
        await expect(page.getByText(fullName(other))).toHaveCount(0);
      }
    });

    test("Talk to first is in priority order with dated Why now tags", async ({ page }) => {
      const talkToFirst = group(page, "Talk to first");

      await expect(entries(talkToFirst)).toHaveText([
        new RegExp(fullName(attemptLatest)),
        new RegExp(fullName(neverContacted)),
        new RegExp(fullName(legacy)),
        new RegExp(fullName(thirtyDays)),
      ]);
      await expect(talkToFirst).toContainText(
        "Not reachable on the last try, or no conversation in 30 days or more. 4 of 6."
      );

      const ira = entry(talkToFirst, attemptLatest);
      const lastTry = istDaysAgo(2);
      await expect(ira.getByText(`Not reachable, ${shortDate(lastTry, istDaysAgo(0))}`)).toBeVisible();
      // The Attempt 2 days ago never counts as Last Contact.
      await expect(ira.getByText("10 days ago")).toBeVisible();
      // The list shows no duration.
      await expect(ira.getByText("25 min")).toHaveCount(0);

      const kabir = entry(talkToFirst, neverContacted);
      await expect(kabir.getByText("No conversation yet")).toBeVisible();
      await expect(kabir.getByText("Never", { exact: true })).toBeVisible();

      const nikhil = entry(talkToFirst, legacy);
      await expect(nikhil.getByText(/^Not contacted in \d+ days$/)).toBeVisible();
      await expect(nikhil.getByText("before app")).toBeVisible();
      await expect(nikhil.getByText("Not recorded")).toHaveCount(0);

      const meera = entry(talkToFirst, thirtyDays);
      await expect(meera.getByText("Not contacted in 30 days")).toBeVisible();
      await expect(meera.getByText("30 days ago")).toBeVisible();
    });

    test("Everyone else holds the 29-day and this-week Students, larger gap first", async ({ page }) => {
      const everyoneElse = group(page, "Everyone else");

      await expect(entries(everyoneElse)).toHaveText([
        new RegExp(fullName(twentyNineDays)),
        new RegExp(fullName(recent)),
      ]);
      await expect(everyoneElse).toContainText("2 of 6.");
      await expect(entry(everyoneElse, twentyNineDays).getByText("29 days ago")).toBeVisible();
      await expect(entry(everyoneElse, recent).getByText("3 days ago")).toBeVisible();
    });

    test("a ready draft shows its chip without changing the group or Last Contact", async ({ page }) => {
      const kabir = entry(group(page, "Talk to first"), neverContacted);
      await expect(kabir.getByText("Draft ready to review")).toBeVisible();
      await expect(kabir.getByText("Never", { exact: true })).toBeVisible();

      // Rohan's failed draft is not ready, so no chip.
      await expect(entry(group(page, "Everyone else"), recent).getByText("Draft ready to review")).toHaveCount(0);
    });

    test("the Resources tab opens the Mentor's resources, and My Students comes back", async ({ page }) => {
      const tabs = page.getByRole("navigation", { name: "Mentor views" });
      await expect(tabs.getByRole("link", { name: "My Students" })).toHaveAttribute("aria-current", "page");
      await tabs.getByRole("link", { name: "Resources" }).click();
      await expect(page).toHaveURL(/\/blended-learning\/resources$/);
      await expect(page.getByRole("heading", { level: 1, name: "Resources" })).toBeAttached();
      await expect(
        page.getByRole("link", { name: /^Mentor Toolkit: Supporting Students Through Non-Academic Stress/ })
      ).toHaveAttribute("target", "_blank");
      await page.getByRole("navigation", { name: "Mentor views" }).getByRole("link", { name: "My Students" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "My Students" })).toBeAttached();
    });

    test("shows each Student's grade, program and gender", async ({ page }) => {
      const ira = entry(group(page, "Talk to first"), attemptLatest);
      await expect(ira.getByText("12", { exact: true })).toBeVisible();
      await expect(ira.getByText("STP Voucher Delhi")).toBeVisible();
      await expect(ira.getByText("Female", { exact: true })).toBeVisible();

      const kabir = entry(group(page, "Talk to first"), neverContacted);
      await expect(kabir.getByText("13", { exact: true })).toBeVisible();
      await expect(kabir.getByText("STP Dropper Delhi")).toBeVisible();
    });

    test("each Student has View and New log text buttons", async ({ page }) => {
      const ira = entry(group(page, "Talk to first"), attemptLatest);
      const view = ira.getByRole("link", { name: `View ${fullName(attemptLatest)}` });
      await expect(view).toHaveAttribute("href", /\/blended-learning\/students\/\d+$/);
      await expect(view).toHaveText("View");
      const newLog = ira.getByRole("link", { name: `New log for ${fullName(attemptLatest)}` });
      await expect(newLog).toHaveAttribute("href", /\/blended-learning\/students\/\d+\/log$/);
      await expect(newLog).toHaveText("New log");
      for (const link of [view, newLog]) expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    });

    if (!desktop) {
      test("renders cards with no horizontal page scroll and 44 px tap targets", async ({ page }) => {
        await expect(entries(group(page, "Talk to first")).first()).toBeVisible();
        await expect(page.getByRole("table")).toHaveCount(0);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow).toBeLessThanOrEqual(0);

        // Per card: the name, View and New log; plus Kabir's
        // "Draft ready to review" chip and the three tabs.
        const links = page.getByRole("main").getByRole("link");
        await expect(links).toHaveCount(6 * 3 + 1 + 3);
        for (const link of await links.all()) {
          const box = await link.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        }
      });
    } else {
      test("renders one table with the mockup's columns and both groups inside it", async ({ page }) => {
        const table = page.getByRole("table");
        await expect(table).toHaveCount(1);
        await expect(table.getByRole("columnheader")).toHaveText([
          "Student", "Why now", "Grade", "Program", "Gender", "Last conversation", "Actions",
        ]);
        // The table fits its card at 1280 px, so nothing is clipped or scrolls.
        const clipped = await table.evaluate((element) => element.scrollWidth - element.parentElement!.clientWidth);
        expect(clipped).toBeLessThanOrEqual(0);
        await expect(table.getByRole("rowgroup", { name: "Talk to first", exact: true })).toBeVisible();
        await expect(table.getByRole("rowgroup", { name: "Everyone else", exact: true })).toBeVisible();
      });

      test("a click anywhere on a row opens the Student", async ({ page }) => {
        const ira = entry(group(page, "Talk to first"), attemptLatest);
        // The name's link stretches over the row, so it takes the click.
        await ira.getByText("STP Voucher Delhi").click({ force: true });
        await expect(page).toHaveURL(/\/blended-learning\/students\/\d+$/);
        await expect(page.getByRole("heading", { name: fullName(attemptLatest) })).toBeVisible();
      });
    }
  });
}
