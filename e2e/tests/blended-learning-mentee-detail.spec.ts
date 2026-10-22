import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  ACTION_ITEM_MENTEES,
  BLENDED_MENTOR_A,
  CONTACTS,
  EARLIER_ACTION_ITEMS,
  IRA_HISTORY,
  MENTEES,
  OTHER_STUDENTS,
  fullName,
} from "../helpers/blended-learning-fixtures";

// One Mentee's detail page (#444) against the real fixture DDL. Fixture facts:
// Ira — Attempt 2 days ago, Attempt and Conversation 10 days ago (the
// Attempt inserted later), Conversation 20 days ago with notes, Action Items,
// two Mentor Flags and two photo rows; WhatsApp differs from her phone; no
// links. Meera — Profile Doc only. Rohan — both links, WhatsApp equal to his
// phone, a failed draft. Kabir — nothing logged, a ready draft. Devika (D1,
// Mentor C) — an open Action Item stored with a due date, which never shows.
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };

const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", viewport: { width: 360, height: 740 } },
] as const;

const { attemptLatest: ira, neverContacted: kabir, thirtyDays: meera, recent: rohan } = MENTEES;
const { conversation20, conversation10, attempt10, attempt2 } = IRA_HISTORY;

const studentIds: Record<string, number> = {};

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id LIKE 'E2E-BL-%'`
    );
    for (const row of result.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
  } finally {
    await pool.end();
  }
});

function detailPath(mentee: { key: string }) {
  return `/blended-learning/students/${studentIds[mentee.key]}`;
}

function historyEntries(page: Page): Locator {
  return page.getByRole("region", { name: "History" }).getByRole("article");
}

function entryWith(page: Page, text: string): Locator {
  return historyEntries(page).filter({ hasText: text });
}

// Photo rows have no S3 object; answer the presigned GETs with a 1×1 PNG.
async function stubS3Photos(page: Page) {
  await page.route(/amazonaws\.com\//, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
        "base64"
      ),
    })
  );
}

for (const { label, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Mentee detail — ${label}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await stubS3Photos(page);
      await signInAs(page, BLENDED_MENTOR_A);
    });

    test("a Mentor opens their Mentee from the list", async ({ page }) => {
      await page.goto("/blended-learning");
      await page.getByRole("link", { name: new RegExp(fullName(ira)) }).first().click();

      await expect(page).toHaveURL(new RegExp(`${detailPath(ira)}$`));
      await expect(page.getByRole("heading", { level: 1, name: fullName(ira) })).toBeVisible();
      await expect(page.getByText("Grade 12")).toBeVisible();
      await expect(page.getByText("STP Voucher Delhi")).toBeVisible();
      await expect(page.getByText("Female")).toBeVisible();
      await expect(page.getByRole("link", { name: "Log conversation" })).toHaveAttribute(
        "href",
        `${detailPath(ira)}/log`
      );

      await page.getByRole("link", { name: "Back to students" }).click();
      await expect(page).toHaveURL(/\/blended-learning$/);
    });

    test("history is newest first, Conversations and Attempts interleaved", async ({ page }) => {
      await page.goto(detailPath(ira));

      // Two Conversations; the Attempts are listed but not counted.
      await expect(
        page.getByRole("region", { name: "History" }).getByRole("heading", { level: 2, name: "Conversations (2)" })
      ).toBeVisible();
      await expect(historyEntries(page)).toHaveText([
        new RegExp(attempt2.note),
        new RegExp(attempt10.note),
        new RegExp(conversation10.summary),
        new RegExp(conversation20.summary),
      ]);
      const attempt = entryWith(page, attempt2.note);
      await expect(attempt.getByText("Attempt", { exact: true })).toBeVisible();
      await expect(attempt.getByText("Not reachable", { exact: true })).toBeVisible();
    });

    test("a Conversation shows its details, Action Items, Mentor Flags and photos", async ({ page }) => {
      await page.goto(detailPath(ira));
      const entry = entryWith(page, conversation20.summary);

      await expect(entry.getByText("In person · 40 min · Spoke with parent or sibling")).toBeVisible();
      await expect(entry.getByRole("heading", { level: 4 })).toHaveText([
        "Summary",
        "Action items",
        "Photos",
        "Flag note for Shalini",
      ]);

      // Owner pill, text, then Open or Done.
      const actionItems = entry.getByRole("list", { name: "Action Items" }).getByRole("listitem");
      await expect(actionItems).toHaveText([
        `Mentor${conversation20.actionItems.done}Done`,
        `Mentor${conversation20.actionItems.open}Open`,
      ]);

      // Flags are chips in the entry's header; the commented one has its note.
      const flags = entry.locator("header").getByRole("list", { name: "Mentor Flags" }).getByRole("listitem");
      await expect(flags).toHaveText(["Flagged to Shalini", "Flagged to Physics teacher"]);
      await expect(entry.getByText(conversation20.flags.wellbeing, { exact: true })).toBeVisible();
      await expect(entry.getByText("Flag note for the Physics teacher")).toHaveCount(0);

      const photos = entry.getByRole("img", { name: /Conversation photo/ });
      await expect(photos).toHaveCount(conversation20.photoCount);
      await expect(photos.first()).toHaveAttribute("src", /X-Amz-Expires=300/);
    });

    test("full notes load only when expanded, from the notes route", async ({ page }) => {
      await page.goto(detailPath(ira));
      const entry = entryWith(page, conversation20.summary);
      await expect(entry).toBeVisible();
      await expect(page.getByText(conversation20.notesText)).toHaveCount(0);

      const notesResponse = page.waitForResponse(/\/api\/blended-learning\/conversations\/\d+\/notes$/);
      await entry.getByRole("button", { name: "Show notes" }).click();
      expect((await notesResponse).status()).toBe(200);

      await expect(entry.getByText(conversation20.notesText)).toBeVisible();
      await expect(entry.getByRole("heading", { name: "Study plan" })).toBeVisible();

      // A Conversation saved without notes offers nothing to expand.
      await expect(entryWith(page, conversation10.summary).getByRole("button", { name: "Show notes" })).toHaveCount(0);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("contact shows WhatsApp only when it differs, and never parent phones", async ({ page }) => {
      await page.goto(detailPath(ira));
      const contact = page.getByRole("region", { name: "Contact" });
      await expect(contact.getByRole("link", { name: CONTACTS.attemptLatest.phone })).toBeVisible();
      await expect(contact.getByText(`WhatsApp ${CONTACTS.attemptLatest.whatsapp}`)).toBeVisible();
      await expect(page.getByText(CONTACTS.attemptLatest.fatherPhone)).toHaveCount(0);
      await expect(page.getByText(CONTACTS.attemptLatest.guardianPhone)).toHaveCount(0);

      await page.goto(detailPath(rohan));
      await expect(page.getByText(CONTACTS.recent.phone)).toHaveCount(1);
      await expect(page.getByText(/WhatsApp/)).toHaveCount(0);
    });

    test("links show only when present", async ({ page }) => {
      const profileDoc = (p: Page) => p.getByRole("link", { name: "Profile doc (opens in a new tab)" });
      const screener = (p: Page) => p.getByRole("link", { name: "Screener form (opens in a new tab)" });

      await page.goto(detailPath(rohan));
      await expect(profileDoc(page)).toHaveAttribute("href", "https://docs.google.com/document/d/e2e-recent");
      await expect(profileDoc(page)).toHaveAttribute("target", "_blank");
      await expect(screener(page)).toHaveAttribute("href", "https://forms.gle/e2e-recent");

      await page.goto(detailPath(meera));
      await expect(profileDoc(page)).toBeVisible();
      await expect(screener(page)).toHaveCount(0);

      await page.goto(detailPath(ira));
      await expect(page.getByRole("heading", { name: fullName(ira) })).toBeVisible();
      await expect(profileDoc(page)).toHaveCount(0);
      await expect(screener(page)).toHaveCount(0);
    });

    test("an open Conversation Draft shows its state", async ({ page }) => {
      await page.goto(detailPath(kabir));
      const kabirDraft = page.getByRole("region", { name: "Conversation Draft" });
      await expect(kabirDraft.getByText("Draft ready to review")).toBeVisible();
      await expect(page.getByText("No conversations yet")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Conversations (0)" })).toBeVisible();

      await page.goto(detailPath(rohan));
      await expect(page.getByRole("region", { name: "Conversation Draft" }).getByText("Drafting failed")).toBeVisible();

      await page.goto(detailPath(ira));
      await expect(page.getByRole("heading", { name: fullName(ira) })).toBeVisible();
      await expect(page.getByRole("region", { name: "Conversation Draft" })).toHaveCount(0);
    });

    test("a Mentor cannot open another Mentor's Mentee or an unmapped Student", async ({ page }) => {
      for (const other of Object.values(OTHER_STUDENTS)) {
        const response = await page.goto(detailPath(other));
        expect(response?.status()).toBe(404);
        await expect(page.getByText(fullName(other))).toHaveCount(0);
      }
    });

    test("at 360 px or wider there is no horizontal page scroll", async ({ page }) => {
      await page.goto(detailPath(ira));
      await expect(historyEntries(page)).toHaveCount(4);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("Blended Learning Mentee detail — admin", () => {
  test("a Blended Learning Admin opens any mapped Mentee, but not an unmapped Student", async ({ page }) => {
    await signInAs(page, BLENDED_ADMIN);

    const mentorBs = await page.goto(detailPath(OTHER_STUDENTS.mentorB));
    expect(mentorBs?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: fullName(OTHER_STUDENTS.mentorB) })).toBeVisible();

    const previousYear = await page.goto(detailPath(OTHER_STUDENTS.previousYear));
    expect(previousYear?.status()).toBe(404);
  });

  test("an Action Item stored with a due date shows its owner but never the due date", async ({ page }) => {
    await signInAs(page, BLENDED_ADMIN);
    await page.goto(detailPath(ACTION_ITEM_MENTEES.desktop));
    // The Action Item spec may tick it done meanwhile; either way it is listed.
    const item = page.getByRole("listitem").filter({ hasText: EARLIER_ACTION_ITEMS.toTick.text }).first();
    await expect(item).toBeVisible();
    await expect(item.getByText("Student", { exact: true })).toBeVisible();
    await expect(page.getByText(/Due \d/)).toHaveCount(0);
  });
});
