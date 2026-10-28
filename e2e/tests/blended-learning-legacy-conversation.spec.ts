import { test, expect, signInAs } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_C,
  LEGACY_CONVERSATION,
  LEGACY_CONVERSATION_MENTEES,
} from "../helpers/blended-learning-fixtures";

// The Profile Doc's latest conversation (the links importer's snapshot) shows
// in full on the detail page and the log page until the Student's first
// Conversation in the app, then as "Open from Profile Doc" while one of its
// action items is open. Only the Student's own Mentor ticks those items, on
// the card; the log form fills nothing in. Mentor C's
// LEGACY_CONVERSATION_MENTEES exist only for this spec, one per viewport.
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const VIEWPORTS = [
  { label: "desktop", key: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", key: "mobile", viewport: { width: 360, height: 740 } },
] as const;
const [finishDpp, shareSchedule, hostelFee] = LEGACY_CONVERSATION.actionItems;

const studentIds: Record<string, number> = {};

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id = ANY($1)`,
      [Object.values(LEGACY_CONVERSATION_MENTEES).map((mentee) => `E2E-BL-${mentee.key}`)]
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
  } finally {
    await pool.end();
  }
});

async function storedRows(studentId: number) {
  const pool = getTestPool();
  try {
    const items = await pool.query(
      `SELECT position, owner, text FROM blended_learning_action_items WHERE student_id = $1 ORDER BY position`,
      [studentId]
    );
    const legacy = await pool.query<{ legacy_action_items: { text: string; done_by_email?: string | null }[] }>(
      `SELECT legacy_action_items FROM blended_learning_student_links WHERE student_id = $1`,
      [studentId]
    );
    return { actionItems: items.rows, legacyItems: legacy.rows[0].legacy_action_items };
  } finally {
    await pool.end();
  }
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

function legacyCard(page: Page, name = "Last Conversation from Profile Doc") {
  return page.getByRole("region", { name });
}

function doneBox(page: Page, text: string, card = legacyCard(page)) {
  return card.getByRole("checkbox", { name: `Done: ${text}` });
}

async function expectLegacyCard(page: Page, profileDocUrl: string, canTick: boolean) {
  const card = legacyCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Last Conversation · from Profile Doc");
  await expect(card).toContainText("14 Jun 2026");
  await expect(card).toContainText(LEGACY_CONVERSATION.summary);
  const items = card.getByRole("list", { name: "Action items from Profile Doc" }).getByRole("listitem");
  await expect(items).toHaveCount(3);
  for (const item of LEGACY_CONVERSATION.actionItems) {
    if (canTick) await expect(doneBox(page, item.text)).toBeEnabled();
    else await expect(doneBox(page, item.text)).toBeDisabled();
  }
  await expect(card.getByRole("link", { name: "Open Profile Doc (opens in a new tab)" })).toHaveAttribute(
    "href",
    profileDocUrl
  );
}

for (const { label, key, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Profile Doc conversation — ${label}`, () => {
    test.use({ viewport });
    const mentee = LEGACY_CONVERSATION_MENTEES[key];
    const profileDocUrl = LEGACY_CONVERSATION.profileDocUrl(mentee.key);

    test("the Mentor ticks Profile Doc action items on the card; it stays while one is open after the first Conversation", async ({
      page,
    }) => {
      const studentId = studentIds[mentee.key];
      const detailPath = `/blended-learning/students/${studentId}`;

      // A view-only admin sees the card with the boxes disabled.
      await signInAs(page, BLENDED_ADMIN_READ_ONLY);
      await page.goto(detailPath);
      await expectLegacyCard(page, profileDocUrl, false);

      // The Mentor sees it near the top, above the history, and ticks one item.
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(detailPath);
      await expectLegacyCard(page, profileDocUrl, true);
      const [cardBox, historyBox] = [
        await legacyCard(page).boundingBox(),
        await page.getByRole("region", { name: "History" }).boundingBox(),
      ];
      expect(cardBox!.y).toBeLessThan(historyBox!.y);
      const schedule = doneBox(page, shareSchedule.text);
      // The whole row is the tap target.
      const row = legacyCard(page).getByRole("listitem").filter({ hasText: shareSchedule.text }).locator("label");
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await schedule.check();
      await expect(legacyCard(page)).toContainText(/Done · \d{1,2} \w+ \d{4} · e2e-blended-mentor-c@test\.local/);
      await expect(schedule).toBeEnabled();
      await page.reload();
      await expect(doneBox(page, shareSchedule.text)).toBeChecked();
      await expect(doneBox(page, finishDpp.text)).not.toBeChecked();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect((await storedRows(studentId)).legacyItems.map((item) => item.done_by_email ?? null)).toEqual([
        null,
        BLENDED_MENTOR_C.email,
        null,
      ]);

      // The log page shows the card in its side panel; the form fills nothing in.
      await page.getByRole("link", { name: "Log conversation", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${detailPath}/log$`));
      await expect(doneBox(page, shareSchedule.text)).toBeChecked();
      await expect(page.getByText("No earlier Conversation. This will be the first one.")).toHaveCount(0);
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      const items = form.getByRole("group", { name: "Action items" });
      await expect(items.getByLabel("Action item 1", { exact: true })).toHaveValue("");
      await expect(items.getByLabel("Action item 2", { exact: true })).toHaveValue("");
      await expect(items.getByLabel("Action item 3", { exact: true })).toHaveCount(0);
      await expect(form.getByText("From Profile Doc")).toHaveCount(0);
      await form.getByLabel("Duration (minutes)").fill("20");
      await form.getByLabel("Summary").fill(`Synthetic ${key}: first call logged in the app.`);
      await form.getByRole("button", { name: "Save conversation" }).click();
      await expect(page.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Conversation saved" })).toBeVisible();
      expect((await storedRows(studentId)).actionItems).toEqual([]);

      // After it, only the action items show, while one is open.
      await page.goto(detailPath);
      await expect(page.getByRole("region", { name: "History" }).getByRole("article")).toHaveCount(1);
      await expect(legacyCard(page)).toHaveCount(0);
      const open = legacyCard(page, "Open from Profile Doc");
      await expect(open).toBeVisible();
      await expect(open).not.toContainText(LEGACY_CONVERSATION.summary);
      await expect(doneBox(page, shareSchedule.text, open)).toBeChecked();
      await doneBox(page, finishDpp.text, open).check();
      await expect(doneBox(page, finishDpp.text, open)).toBeEnabled();
      // Ticking the last one hides the card.
      await doneBox(page, hostelFee.text, open).check();
      await expect(open).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(legacyCard(page, "Open from Profile Doc")).toHaveCount(0);

      await page.goto(`${detailPath}/log`);
      await expect(page.getByRole("region", { name: "Last Conversation" })).toContainText(
        `Synthetic ${key}: first call logged in the app.`
      );
      await expect(page.getByRole("region", { name: /Profile Doc/ })).toHaveCount(0);
    });
  });
}
