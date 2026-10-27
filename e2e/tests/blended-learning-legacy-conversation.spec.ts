import { test, expect, signInAs } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_C,
  LEGACY_CONVERSATION,
  LEGACY_CONVERSATION_MENTEES,
} from "../helpers/blended-learning-fixtures";

// Before a Mentor logs a Student's first Conversation in the app, the
// Profile Doc's latest conversation (the links importer's snapshot) shows on
// the detail page and the log page, and its Action Items carry into the new
// Conversation, editable. Once a Conversation is saved, it supersedes the
// snapshot. Mentor C's LEGACY_CONVERSATION_MENTEES exist only for this spec,
// one per viewport.
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const VIEWPORTS = [
  { label: "desktop", key: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", key: "mobile", viewport: { width: 360, height: 740 } },
] as const;
const NOTICE =
  "These action items were auto-filled from the last conversation in the Profile Doc. Remove any that are done before saving.";
const EXPLANATION = "Auto-filled from the last conversation in the Profile Doc";
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

async function savedActionItems(studentId: number) {
  const pool = getTestPool();
  try {
    const result = await pool.query(
      `SELECT position, owner, text, status FROM blended_learning_action_items
       WHERE student_id = $1 ORDER BY position`,
      [studentId]
    );
    return result.rows;
  } finally {
    await pool.end();
  }
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

function legacyCard(page: Page) {
  return page.getByRole("region", { name: "Last Conversation from Profile Doc" });
}

async function expectLegacyCard(page: Page, profileDocUrl: string) {
  const card = legacyCard(page);
  await expect(card).toBeVisible();
  await expect(card).toContainText("Last Conversation · from Profile Doc");
  await expect(card).toContainText("14 Jun 2026");
  await expect(card).toContainText(LEGACY_CONVERSATION.summary);
  const items = card.getByRole("list", { name: "Action items from Profile Doc" }).getByRole("listitem");
  await expect(items).toHaveText([
    `Student${finishDpp.text}`,
    `Mentor${shareSchedule.text}`,
    `Parent${hostelFee.text}`,
  ]);
  await expect(card.getByRole("link", { name: "Open Profile Doc (opens in a new tab)" })).toHaveAttribute(
    "href",
    profileDocUrl
  );
}

for (const { label, key, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Profile Doc carry-over — ${label}`, () => {
    test.use({ viewport });
    const mentee = LEGACY_CONVERSATION_MENTEES[key];
    const profileDocUrl = LEGACY_CONVERSATION.profileDocUrl(mentee.key);

    test("the Profile Doc's last conversation shows until the first Conversation, which carries its Action Items", async ({
      page,
    }) => {
      const studentId = studentIds[mentee.key];
      const detailPath = `/blended-learning/students/${studentId}`;

      // A view-only admin sees the card on the detail page too.
      await signInAs(page, BLENDED_ADMIN_READ_ONLY);
      await page.goto(detailPath);
      await expectLegacyCard(page, profileDocUrl);

      // The Mentor sees it near the top, above the history, while preparing.
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(detailPath);
      await expectLegacyCard(page, profileDocUrl);
      const [cardBox, historyBox] = [
        await legacyCard(page).boundingBox(),
        await page.getByRole("region", { name: "History" }).boundingBox(),
      ];
      expect(cardBox!.y).toBeLessThan(historyBox!.y);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await page.getByRole("link", { name: "Log conversation", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${detailPath}/log$`));
      // The side panel shows the Profile Doc's conversation instead of "No earlier Conversation".
      await expectLegacyCard(page, profileDocUrl);
      await expect(page.getByText("No earlier Conversation. This will be the first one.")).toHaveCount(0);

      // Its Action Items are pre-filled, under a notice, each marked.
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      const items = form.getByRole("group", { name: "Action items" });
      await expect(items.getByRole("note")).toHaveText(NOTICE);
      for (const [index, item] of LEGACY_CONVERSATION.actionItems.entries()) {
        await expect(items.getByLabel(`Who does action item ${index + 1}`, { exact: true })).toHaveValue(item.owner);
        await expect(items.getByLabel(`Action item ${index + 1}`, { exact: true })).toHaveValue(item.text);
      }
      await expect(items.getByLabel("Action item 4", { exact: true })).toHaveCount(0);
      const markers = items.getByRole("button", { name: "From Profile Doc" });
      await expect(markers).toHaveCount(3);
      await expect(items.getByLabel("Action item 1", { exact: true })).toHaveAccessibleDescription(EXPLANATION);
      // The explanation opens on a tap (a click), not only on hover.
      await expect(items.getByRole("tooltip").first()).toBeHidden();
      await markers.first().click();
      await expect(items.getByRole("tooltip").first()).toBeVisible();
      await expect(items.getByRole("tooltip").first()).toHaveText(EXPLANATION);
      // Opaque, inside the viewport, and drawn above the next row's controls.
      const tooltip = items.getByRole("tooltip").first();
      await expect(tooltip).toHaveCSS("opacity", "1");
      await tooltip.scrollIntoViewIfNeeded();
      const onTop = await tooltip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { hit: element.contains(hit), left: box.left, right: box.right, width: window.innerWidth };
      });
      expect(onTop.hit).toBe(true);
      expect(onTop.left).toBeGreaterThanOrEqual(0);
      expect(onTop.right).toBeLessThanOrEqual(onTop.width);
      expect((await markers.first().boundingBox())!.height).toBeGreaterThanOrEqual(key === "mobile" ? 44 : 32);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      // The schedule was already shared: remove it, and save the rest.
      await items.getByRole("button", { name: "Remove action item 2" }).click();
      await expect(markers).toHaveCount(2);
      await form.getByLabel("Duration (minutes)").fill("20");
      await form.getByLabel("Summary").fill(`Synthetic ${key}: first call logged in the app.`);
      await form.getByRole("button", { name: "Save conversation" }).click();

      const saved = page.getByRole("region", { name: "Saved" });
      await expect(saved.getByRole("heading", { name: "Conversation saved" })).toBeVisible();
      expect(await savedActionItems(studentId)).toEqual([
        { position: 1, owner: finishDpp.owner, text: finishDpp.text, status: "open" },
        { position: 2, owner: hostelFee.owner, text: hostelFee.text, status: "open" },
      ]);

      // The app's own Conversation now wins: no Profile Doc card anywhere,
      // and the carried items are ordinary open Action Items.
      await page.goto(detailPath);
      await expect(page.getByRole("region", { name: "History" }).getByRole("article")).toHaveCount(1);
      await expect(legacyCard(page)).toHaveCount(0);
      const open = page.getByRole("region", { name: "Open Action Items" });
      await expect(open).toContainText(finishDpp.text);
      await expect(open).toContainText(hostelFee.text);
      await expect(open).not.toContainText(shareSchedule.text);

      await page.goto(`${detailPath}/log`);
      await expect(legacyCard(page)).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Last Conversation" })).toContainText(
        `Synthetic ${key}: first call logged in the app.`
      );
      const freshItems = page.getByRole("group", { name: "Action items" });
      await expect(freshItems.getByRole("note")).toHaveCount(0);
      await expect(freshItems.getByLabel("Action item 1", { exact: true })).toHaveValue("");
    });
  });
}
