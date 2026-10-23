import { test, expect, signInAs } from "../fixtures/auth";
import type { Browser, Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_B,
  MENTEES,
  fullName,
} from "../helpers/blended-learning-fixtures";

// The admin Mentors tab and one Mentor's page (#452). Expected counts are
// hand-computed from the fixture facts in blended-learning-fixtures.ts
// (IST days before today; Attempts and drafts never count as contact):
//   Mentor A — Ira G12 (Conversation 10, Attempt 2), Kabir G13 (nothing, a
//   ready draft), Meera G12 (30; 45 too), Nikhil G13 (legacy date 14 Jun 2026), Zoya
//   G12 (29; older bulk-flag Conversations), Rohan G12 (3, a failed draft):
//   6 assigned, 4 + 2, last 7 days = Rohan, 30+ days = Kabir, Meera, Nikhil.
//   Mentor B — Sana G12 (nothing), Tara G13 (flagged Conversations 35 and 40
//   days ago, #453): 2 assigned, 1 + 1, last 7 days = 0, 30+ days = both.
//   Sana's ended Mapping to Mentor A and Uday's previous-year Mapping never
//   count for Mentor A.
// Mentor C's Mentees are mutated by other specs, so no count is asserted.
const EXPECTED_CARDS = [
  {
    mentor: BLENDED_MENTOR_A,
    stats: { Assigned: "6", "Grade 12": "4", "Grade 13": "2", "Talked in last 7 days": "1", "Not spoken 30+ days": "3" },
  },
  {
    mentor: BLENDED_MENTOR_B,
    stats: { Assigned: "2", "Grade 12": "1", "Grade 13": "1", "Talked in last 7 days": "0", "Not spoken 30+ days": "2" },
  },
] as const;

const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const READ_ONLY_ADMIN = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};

const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 }, entryRole: "row" },
  { label: "mobile 360", viewport: { width: 360, height: 740 }, entryRole: "listitem" },
] as const;

const { attemptLatest, neverContacted, thirtyDays, legacy, twentyNineDays, recent } = MENTEES;

let mentorAUserId = 0;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ id: string }>(
      `SELECT user_id AS id FROM user_permission WHERE LOWER(email) = LOWER($1)`,
      [BLENDED_MENTOR_A.email]
    );
    mentorAUserId = Number(result.rows[0].id);
  } finally {
    await pool.end();
  }
});

function mentorCard(page: Page, mentor: { name: string }): Locator {
  return page
    .getByRole("list", { name: "Mentors" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: mentor.name, exact: true }) });
}

function stat(card: Locator, label: string): Locator {
  return card.locator(`dt:text-is("${label}") + dd`);
}

// The Student list's groups: named rowgroups of one table from 1024 px up,
// regions of cards below that.
function group(page: Page, name: "Talk to first" | "Everyone else"): Locator {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  return page.getByRole(desktop ? "rowgroup" : "region", { name, exact: true });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function mentorOwnView(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signInAs(page, BLENDED_MENTOR_A);
  await page.goto("/blended-learning");
  return { page, close: () => context.close() };
}

for (const { label, viewport, entryRole } of VIEWPORTS) {
  test.describe(`Blended Learning Mentors tab — ${label}`, () => {
    test.use({ viewport });

    function entries(section: Locator): Locator {
      const all = section.getByRole(entryRole);
      return entryRole === "row" ? all.filter({ has: section.page().getByRole("cell") }) : all;
    }

    test("a Blended Learning Admin sees one card per Mentor with load and recency", async ({ page }) => {
      await signInAs(page, BLENDED_ADMIN);
      await page.goto("/blended-learning");

      const tabs = page.getByRole("navigation", { name: "Admin views" });
      await expect(tabs.getByRole("link", { name: "Mentors" })).toHaveAttribute("aria-current", "page");
      await expect(tabs.getByRole("link", { name: "Flags" })).toBeVisible();

      for (const { mentor, stats } of EXPECTED_CARDS) {
        const card = mentorCard(page, mentor);
        await expect(card).toHaveCount(1);
        for (const [statLabel, value] of Object.entries(stats)) {
          await expect(stat(card, statLabel)).toHaveText(value);
        }
      }
    });

    test("opening a card shows that Mentor's list exactly as the Mentor sees it", async ({ page, browser }) => {
      await signInAs(page, BLENDED_ADMIN);
      await page.goto("/blended-learning");
      await mentorCard(page, BLENDED_MENTOR_A).getByRole("link").click();

      await expect(page).toHaveURL(new RegExp(`/blended-learning/mentors/${mentorAUserId}$`));
      await expect(page.getByRole("heading", { name: BLENDED_MENTOR_A.name, exact: true })).toBeVisible();

      const talkToFirst = entries(group(page, "Talk to first"));
      await expect(talkToFirst).toHaveText(
        [attemptLatest, neverContacted, legacy, thirtyDays].map((mentee) => new RegExp(fullName(mentee)))
      );
      await expect(entries(group(page, "Everyone else"))).toHaveText(
        [twentyNineDays, recent].map((mentee) => new RegExp(fullName(mentee)))
      );
      await expect(talkToFirst.filter({ hasText: fullName(attemptLatest) }).getByText(/^Not reachable, \d{1,2} [A-Z][a-z]{2}/)).toBeVisible();
      await expect(talkToFirst.filter({ hasText: fullName(neverContacted) }).getByText("Draft ready to review")).toBeVisible();
      // Admins are view only: the chip is a plain label and no row offers a new log.
      await expect(
        talkToFirst.filter({ hasText: fullName(neverContacted) }).getByRole("link", { name: "Draft ready to review" })
      ).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^New log for / })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^View / })).toHaveCount(6);
      // Search and filters come with the shared list component.
      await expect(page.getByRole("searchbox", { name: "Search by name" })).toBeVisible();

      const own = await mentorOwnView(browser, viewport);
      try {
        for (const name of ["Talk to first", "Everyone else"] as const) {
          // The same rows, less the Mentor's own "New log" button.
          const mentorSees = (await entries(group(own.page, name)).allTextContents()).map((text) =>
            text.replace(/\s*New log\s*$/, "")
          );
          expect(mentorSees.length).toBeGreaterThan(0);
          await expect(entries(group(page, name))).toHaveText(mentorSees);
        }
      } finally {
        await own.close();
      }

      await talkToFirst.filter({ hasText: fullName(attemptLatest) }).getByRole("link").first().click();
      await expect(page.getByRole("heading", { name: fullName(attemptLatest) })).toBeVisible();
      await expect(page.getByRole("link", { name: "Log conversation", exact: true })).toHaveCount(0);

      // Back to the Mentor's list the admin came from, not the Mentors cards.
      await page.getByRole("link", { name: "Back to Synthetic's students" }).click();
      await expect(page).toHaveURL(new RegExp(`/blended-learning/mentors/${mentorAUserId}$`));
      await expect(page.getByRole("heading", { name: BLENDED_MENTOR_A.name, exact: true })).toBeVisible();
    });

    test("a read-only Blended Learning Admin can view cards and a Mentor's page", async ({ page }) => {
      await signInAs(page, READ_ONLY_ADMIN);
      await page.goto("/blended-learning");
      await expect(stat(mentorCard(page, BLENDED_MENTOR_A), "Assigned")).toHaveText("6");

      await page.goto(`/blended-learning/mentors/${mentorAUserId}`);
      await expect(entries(group(page, "Talk to first"))).toHaveCount(4);
      await expect(entries(group(page, "Everyone else"))).toHaveCount(2);

      // Kabir's ready draft is shown, but not as a link into a log form a
      // read-only admin can't use (QA-14).
      const kabir = entries(group(page, "Talk to first")).filter({ hasText: fullName(neverContacted) });
      await expect(kabir.getByText("Draft ready to review")).toBeVisible();
      await expect(page.getByRole("link", { name: "Draft ready to review" })).toHaveCount(0);
    });

    test("an LMS admin sees the Mentors tab inside the dashboard, down to a Student", async ({ adminPage }) => {
      await adminPage.goto("/blended-learning");
      await expect(stat(mentorCard(adminPage, BLENDED_MENTOR_B), "Assigned")).toHaveText("2");

      // Every page keeps the dashboard's header and tabs, Blended Learning selected.
      const inDashboard = async () => {
        await expect(adminPage.getByRole("banner").getByRole("img", { name: "Avanti Fellows" })).toBeVisible();
        await expect(adminPage.getByRole("link", { name: "Blended Learning", exact: true })).toHaveAttribute(
          "aria-current",
          "page"
        );
        await expect(adminPage.getByText("Blended Learning Admin", { exact: true })).toHaveCount(0);
      };
      await inDashboard();

      await mentorCard(adminPage, BLENDED_MENTOR_A).getByRole("link").click();
      await expect(adminPage).toHaveURL(new RegExp(`/blended-learning/mentors/${mentorAUserId}$`));
      await inDashboard();

      await entries(group(adminPage, "Talk to first"))
        .filter({ hasText: fullName(attemptLatest) })
        .getByRole("link")
        .first()
        .click();
      await expect(adminPage.getByRole("heading", { level: 1, name: fullName(attemptLatest) })).toBeVisible();
      await inDashboard();
      await expect(adminPage.getByRole("link", { name: "Back to Synthetic's students" })).toHaveAttribute(
        "href",
        `/blended-learning/mentors/${mentorAUserId}`
      );
      await noHorizontalScroll(adminPage);
    });

    test("a Mentor cannot reach the Mentors tab or a Mentor's page", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto("/blended-learning");
      await expect(entries(group(page, "Talk to first"))).toHaveCount(4);
      await expect(page.getByRole("navigation", { name: "Admin views" })).toHaveCount(0);
      await expect(page.getByRole("list", { name: "Mentors" })).toHaveCount(0);

      await page.goto(`/blended-learning/mentors/${mentorAUserId}`);
      await expect(page).toHaveURL(/\/blended-learning$/);
      await expect(page.getByRole("heading", { name: BLENDED_MENTOR_A.name, exact: true })).toHaveCount(0);
    });

    if (entryRole === "listitem") {
      test("cards stack with no horizontal page scroll", async ({ page }) => {
        await signInAs(page, BLENDED_ADMIN);
        await page.goto("/blended-learning");

        const first = await mentorCard(page, BLENDED_MENTOR_A).boundingBox();
        const second = await mentorCard(page, BLENDED_MENTOR_B).boundingBox();
        expect(first && second).toBeTruthy();
        expect(second!.x).toBe(first!.x);
        expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);
        await noHorizontalScroll(page);

        await page.goto(`/blended-learning/mentors/${mentorAUserId}`);
        await expect(entries(group(page, "Talk to first"))).toHaveCount(4);
        await noHorizontalScroll(page);
      });
    }
  });
}
