import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_B,
  BLENDED_MENTOR_C,
  CONTACTS,
  FEED_FLAGS,
  FLAGS_LAST_SEEN_HOURS_AGO,
  IRA_HISTORY,
  MENTEES,
  TARA_LINKS,
  bulkFlagComment,
  fullName,
} from "../helpers/blended-learning-fixtures";

// The admin Flags feed (#453) against the real fixture DDL. Expected cards
// come from the hand-written fixture facts in blended-learning-fixtures.ts
// (FEED_FLAGS, the bulk flags and IRA_HISTORY). Other specs append flags on
// Mentor C's Mentees while the suite runs; they are the newest, so cards are
// compared without them and "N new" adds however many exist.
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", viewport: { width: 360, height: 740 } },
] as const;

const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const READ_ONLY_ADMIN = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};

const { attemptLatest: ira, twentyNineDays: zoya } = MENTEES;

// Card patterns, newest first. A bulk flag is named by its unique comment.
const IRA_PHYSICS = new RegExp(`${fullName(ira)}[\\s\\S]*Physics Teacher`);
const IRA_WELLBEING = new RegExp(`${fullName(ira)}[\\s\\S]*${IRA_HISTORY.conversation20.flags.wellbeing}`);
const MEERA_CHEMISTRY = new RegExp(FEED_FLAGS.meeraChemistry.comment);
const TARA_MATHS = new RegExp(FEED_FLAGS.taraMaths.comment);
const TARA_WELLBEING = new RegExp(FEED_FLAGS.taraWellbeing.comment);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bulk = (...ns: number[]) => ns.map((n) => new RegExp(escape(bulkFlagComment(n))));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
// Fixture flags raised after the admins' seeded last visit.
const FIXTURE_NEW = 4;

async function withPool<T>(fn: (pool: ReturnType<typeof getTestPool>) => Promise<T>): Promise<T> {
  const pool = getTestPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

// Put the viewer's last visit back where the fixture seeded it.
async function resetLastSeen(email: string) {
  await withPool((pool) =>
    pool.query(
      `UPDATE blended_learning_flag_views SET last_seen_at = now() - make_interval(hours => $2)
       WHERE lower(viewer_email) = lower($1)`,
      [email, FLAGS_LAST_SEEN_HOURS_AGO]
    )
  );
}

// Flags other specs have raised on Mentor C's Mentees so far.
async function mentorCFlagCount(): Promise<number> {
  return withPool(async (pool) => {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM blended_learning_mentor_flags flag
       JOIN blended_learning_conversations c ON c.id = flag.conversation_id
       JOIN user_permission mentor ON mentor.user_id = c.mentor_user_id
       WHERE LOWER(mentor.email) = LOWER($1)`,
      [BLENDED_MENTOR_C.email]
    );
    return result.rows[0].count;
  });
}

function feed(page: Page): Locator {
  return page.getByRole("region", { name: "Mentor Flags" });
}

function cards(page: Page): Locator {
  return feed(page).getByRole("article");
}

function fixtureCards(page: Page): Locator {
  return cards(page).filter({ hasNotText: new RegExp(`${BLENDED_MENTOR_C.name}\\b`) });
}

function badge(count: number): RegExp {
  return new RegExp(`^Flags\\s*${count} new$`);
}

function flagsTab(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin views" }).getByRole("link", { name: /Flags/ });
}

async function openFlags(page: Page, query = "") {
  const seen = page.waitForResponse(
    (response) => response.url().endsWith("/api/blended-learning/flags/seen") && response.request().method() === "POST"
  );
  await page.goto(`/blended-learning?tab=flags${query}`);
  expect((await seen).status()).toBe(200);
}

// Each filter applies as soon as it changes (no Apply button): the URL is
// pushed without a full reload. Only a changed select navigates.
async function filterBy(page: Page, filters: { mentor?: string; recipient?: string }) {
  const form = page.getByRole("search", { name: "Filter flags" });
  for (const [label, option] of [
    ["Mentor", filters.mentor ?? "All Mentors"],
    ["Flag Recipient", filters.recipient ?? "All recipients"],
  ] as const) {
    const select = form.getByLabel(label);
    const wanted = await select.locator("option", { hasText: new RegExp(`^${option}$`) }).getAttribute("value");
    if ((await select.inputValue()) === wanted) continue;
    await select.selectOption({ label: option });
    await page.waitForURL((url) => (url.searchParams.get(label === "Mentor" ? "mentor" : "recipient") ?? "") === wanted);
  }
  await expect(form).not.toHaveAttribute("aria-busy", "true");
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const { label, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Flags feed — ${label}`, () => {
    test.use({ viewport });

    test.beforeEach(async () => {
      await resetLastSeen(BLENDED_ADMIN.email);
      await resetLastSeen(READ_ONLY_ADMIN.email);
    });

    test("the feed lists every Mentor Flag newest first, with what an admin needs to act", async ({ page }) => {
      await signInAs(page, BLENDED_ADMIN);
      await openFlags(page);

      await expect(flagsTab(page)).toHaveAttribute("aria-current", "page");
      // Ira's two flags tie on inserted_at, so the later id comes first.
      for (const [i, card] of [IRA_PHYSICS, IRA_WELLBEING, MEERA_CHEMISTRY, TARA_MATHS, TARA_WELLBEING, ...bulk(1)].entries()) {
        await expect(fixtureCards(page).nth(i)).toHaveText(card);
      }

      const conversationDate = await withPool(async (pool) => {
        const result = await pool.query<{ shown: string }>(
          `SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date - $1::int, 'FMDD Mon YYYY') AS shown`,
          [IRA_HISTORY.conversation20.daysAgo]
        );
        return result.rows[0].shown;
      });
      const iraWellbeing = cards(page).filter({ hasText: IRA_HISTORY.conversation20.flags.wellbeing });
      await expect(iraWellbeing.getByRole("heading", { name: fullName(ira) })).toBeVisible();
      // The name opens the Student; its arrow is decorative, so the link is named by the name alone.
      const studentLink = iraWellbeing.getByRole("link", { name: fullName(ira), exact: true });
      await expect(studentLink).toHaveAttribute("href", /\/blended-learning\/students\/\d+$/);
      await expect(studentLink.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(iraWellbeing.getByText("Emotional Well-being", { exact: true })).toBeVisible();
      await expect(iraWellbeing.getByText("Grade 12 · STP Voucher Delhi · Female")).toBeVisible();
      // Postgres writes "Sep"; en-GB dates write "Sept".
      await expect(
        iraWellbeing.getByText(new RegExp(`^${conversationDate.replace(/^(\d+ )Sep /, "$1Sept ")} · ${BLENDED_MENTOR_A.name}$`))
      ).toBeVisible();
      await expect(iraWellbeing.getByText(CONTACTS.attemptLatest.phone)).toBeVisible();
      await expect(iraWellbeing.getByText(CONTACTS.attemptLatest.whatsapp)).toBeVisible();
      await expect(iraWellbeing.getByText(CONTACTS.attemptLatest.fatherPhone)).toHaveCount(0);
      await expect(iraWellbeing.getByRole("link", { name: "Profile Doc" })).toHaveCount(0);
      await expect(iraWellbeing.getByRole("link", { name: "Screener Link" })).toHaveCount(0);

      // Full notes only on request, through the notes route.
      await expect(page.getByText(IRA_HISTORY.conversation20.notesText)).toHaveCount(0);
      await iraWellbeing.getByRole("button", { name: "Show Session Notes" }).click();
      await expect(iraWellbeing.getByRole("button", { name: "Hide Session Notes" })).toBeVisible();
      await expect(iraWellbeing.getByText(IRA_HISTORY.conversation20.notesText)).toBeVisible();

      const taraMaths = cards(page).filter({ hasText: FEED_FLAGS.taraMaths.comment });
      await expect(taraMaths.getByText(`· ${BLENDED_MENTOR_B.name}`)).toBeVisible();
      await expect(taraMaths.getByRole("link", { name: "Profile Doc" })).toHaveAttribute("href", TARA_LINKS.profileDoc);
      await expect(taraMaths.getByRole("link", { name: "Screener Link" })).toHaveAttribute("href", TARA_LINKS.screener);
      // Saved without notes: nothing to show.
      await expect(taraMaths.getByRole("button", { name: "Show Session Notes" })).toHaveCount(0);

      const meeraChemistry = cards(page).filter({ hasText: FEED_FLAGS.meeraChemistry.comment });
      await expect(meeraChemistry.getByRole("link", { name: "Profile Doc" })).toBeVisible();
      await expect(meeraChemistry.getByRole("link", { name: "Screener Link" })).toHaveCount(0);

      await noHorizontalScroll(page);
    });

    test("the Mentor and Flag Recipient filters narrow the feed, alone and combined", async ({ page }) => {
      await signInAs(page, BLENDED_ADMIN);
      await openFlags(page);
      // Marks this document: a full reload would drop it.
      await page.evaluate(() => Object.assign(window, { __sameDocument: true }));

      await filterBy(page, { mentor: BLENDED_MENTOR_B.name });
      await expect(cards(page)).toHaveText([TARA_MATHS, TARA_WELLBEING]);

      await filterBy(page, { recipient: "Maths Teacher" });
      await expect(fixtureCards(page)).toHaveText([TARA_MATHS, ...bulk(...range(0, 12).map((c) => 4 * c + 1))]);

      await filterBy(page, { mentor: BLENDED_MENTOR_A.name, recipient: "Chemistry Teacher" });
      await expect(cards(page)).toHaveText([MEERA_CHEMISTRY, ...bulk(...range(0, 12).map((c) => 4 * c + 2))]);

      await filterBy(page, { mentor: BLENDED_MENTOR_B.name, recipient: "Emotional Well-being" });
      await expect(cards(page)).toHaveText([TARA_WELLBEING]);
      await expect(page.getByRole("search", { name: "Filter flags" }).getByLabel("Mentor")).toHaveValue(/\d+/);

      await filterBy(page, { mentor: BLENDED_MENTOR_B.name, recipient: "Physics Teacher" });
      await expect(cards(page)).toHaveCount(0);
      await expect(feed(page).getByText("No Mentor Flags match these filters.")).toBeVisible();

      // The URL holds the filters, so Back steps to the previous ones, and
      // none of it reloaded the page.
      await page.goBack();
      await expect(cards(page)).toHaveText([TARA_WELLBEING]);
      await expect(page.getByRole("search", { name: "Filter flags" }).getByLabel("Flag Recipient")).toHaveValue(
        "emotional_wellbeing"
      );
      expect(await page.evaluate(() => (window as { __sameDocument?: boolean }).__sameDocument)).toBe(true);

      await noHorizontalScroll(page);
    });

    test("pages hold 50 flags, and the next page continues with no duplicates or gaps", async ({ page }) => {
      await signInAs(page, BLENDED_ADMIN);
      await openFlags(page);
      await filterBy(page, { mentor: BLENDED_MENTOR_A.name });

      // Mentor A: Ira's two, Meera's one, then Zoya's 52 bulk flags.
      await expect(cards(page)).toHaveText([IRA_PHYSICS, IRA_WELLBEING, MEERA_CHEMISTRY, ...bulk(...range(1, 47))]);

      await page.getByRole("link", { name: "Older flags" }).click();
      // The page boundary falls between flags 47 and 48, which tie on inserted_at.
      await expect(cards(page)).toHaveText(bulk(...range(48, 52)));
      await expect(cards(page).filter({ hasText: fullName(zoya) })).toHaveCount(5);
      await expect(page.getByRole("link", { name: "Older flags" })).toHaveCount(0);

      await page.getByRole("link", { name: "Newest flags" }).click();
      await expect(cards(page)).toHaveCount(50);
      await expect(cards(page).first()).toHaveText(IRA_PHYSICS);
    });

    test('"N new" counts flags since the last visit, and clears on the next visit', async ({ page }) => {
      await signInAs(page, BLENDED_ADMIN);
      const expectedNew = FIXTURE_NEW + (await mentorCFlagCount());

      // The badge shows on the Mentors tab too, which records no visit.
      await page.goto("/blended-learning");
      await expect(flagsTab(page)).toHaveText(badge(expectedNew));

      await openFlags(page);
      await expect(flagsTab(page)).toHaveText(badge(expectedNew));
      // Still highlighted for this visit, after the visit was recorded.
      const newCards = fixtureCards(page).filter({ has: page.getByText("New", { exact: true }) });
      await expect(newCards).toHaveText([IRA_PHYSICS, IRA_WELLBEING, MEERA_CHEMISTRY, TARA_MATHS]);
      await expect(cards(page).filter({ hasText: FEED_FLAGS.taraWellbeing.comment }).getByText("New", { exact: true })).toHaveCount(0);

      // Filter and page changes are the same visit: the badge and the New
      // markers stay, and no further visit is recorded (QA-12).
      const seenPosts: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/api/blended-learning/flags/seen")) {
          seenPosts.push(request.url());
        }
      });
      const newMarkers = () => fixtureCards(page).filter({ has: page.getByText("New", { exact: true }) });

      await filterBy(page, { mentor: BLENDED_MENTOR_B.name });
      await expect(cards(page)).toHaveText([TARA_MATHS, TARA_WELLBEING]);
      await expect(flagsTab(page)).toHaveText(badge(expectedNew));
      await expect(newMarkers()).toHaveText([TARA_MATHS]);

      await filterBy(page, { recipient: "Maths Teacher" });
      await expect(fixtureCards(page)).toHaveText([TARA_MATHS, ...bulk(...range(0, 12).map((c) => 4 * c + 1))]);
      await expect(newMarkers()).toHaveText([TARA_MATHS]);

      await filterBy(page, { mentor: BLENDED_MENTOR_A.name, recipient: "Chemistry Teacher" });
      await expect(cards(page)).toHaveText([MEERA_CHEMISTRY, ...bulk(...range(0, 12).map((c) => 4 * c + 2))]);
      await expect(newMarkers()).toHaveText([MEERA_CHEMISTRY]);

      await filterBy(page, { mentor: BLENDED_MENTOR_A.name });
      await expect(cards(page)).toHaveText([IRA_PHYSICS, IRA_WELLBEING, MEERA_CHEMISTRY, ...bulk(...range(1, 47))]);
      await expect(newMarkers()).toHaveText([IRA_PHYSICS, IRA_WELLBEING, MEERA_CHEMISTRY]);
      await page.getByRole("link", { name: "Older flags" }).click();
      await expect(cards(page)).toHaveText(bulk(...range(48, 52)));
      await expect(flagsTab(page)).toHaveText(badge(expectedNew));
      await page.getByRole("link", { name: "Newest flags" }).click();
      await expect(cards(page).first()).toHaveText(IRA_PHYSICS);
      await expect(newMarkers()).toHaveText([IRA_PHYSICS, IRA_WELLBEING, MEERA_CHEMISTRY]);
      await expect(flagsTab(page)).toHaveText(badge(expectedNew));
      expect(seenPosts).toEqual([]);

      // Leaving the tab and opening it again is the next visit.
      await openFlags(page);
      await expect(flagsTab(page)).toHaveText("Flags");
      await expect(cards(page).getByText("New", { exact: true })).toHaveCount(0);
      await expect(fixtureCards(page).first()).toHaveText(IRA_PHYSICS);
    });

    test("a read-only admin's visit clears their own \"N new\", with no mutation controls", async ({ page }) => {
      await signInAs(page, READ_ONLY_ADMIN);
      const expectedNew = FIXTURE_NEW + (await mentorCFlagCount());

      await openFlags(page);
      await expect(page.getByText("Blended Learning Admin · Read only")).toBeVisible();
      await expect(flagsTab(page)).toHaveText(badge(expectedNew));
      await expect(fixtureCards(page).first()).toBeVisible();
      // Only Show Session Notes; no Apply (filters apply on change), logging, ticking or drafts.
      const buttons = await page.getByRole("main").getByRole("button").allTextContents();
      expect(new Set(buttons)).toEqual(new Set(["Show Session Notes"]));
      await expect(page.getByRole("link", { name: "Log conversation", exact: true })).toHaveCount(0);

      await openFlags(page);
      await expect(flagsTab(page)).toHaveText("Flags");
      await expect(cards(page).getByText("New", { exact: true })).toHaveCount(0);
    });
  });
}

test.describe("Blended Learning Flags feed — Mentor", () => {
  test("a Mentor cannot reach the Flags tab or record a visit", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_A);

    await page.goto("/blended-learning?tab=flags");
    await expect(page.getByRole("heading", { level: 1, name: "Students" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin views" })).toHaveCount(0);
    await expect(feed(page)).toHaveCount(0);

    const response = await page.request.post("/api/blended-learning/flags/seen");
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });
});
