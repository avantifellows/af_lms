import "../helpers/test-db-env";
import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { getTestPool } from "../helpers/db";
import importerPool from "../../src/lib/db";
import { parseLegacyConversations } from "../../src/lib/blended-learning-legacy-conversations";
import {
  legacyDateWindow,
  profileDocId,
  runBlendedLinksImport,
} from "../../src/lib/blended-learning-links-import";
import {
  BLENDED_MENTOR_C,
  LEGACY_CONVERSATION,
  LEGACY_CONVERSATION_MENTEES,
} from "../helpers/blended-learning-fixtures";

// The Profile Doc's latest entry, as the links importer loads it: its action
// items are ordinary open Action Items ("From Profile Doc") in the one Open
// Action Items list, ticked done from the log form like any other, and the
// entry itself sits in the conversation history at its date without counting
// as a Conversation. A re-import keeps what was ticked. Mentor C's
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
const NEW_ITEM = { text: "Synthetic: book the counselling slot", owner: "parent" } as const;

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

test.afterAll(async () => {
  // The importer's own pool, used by reimport().
  await importerPool.end();
});

async function profileDocItems(studentId: number) {
  const pool = getTestPool();
  try {
    const items = await pool.query<{ text: string; status: string; closed: boolean }>(
      `SELECT text, status, completed_by_conversation_id IS NOT NULL AS closed
       FROM blended_learning_action_items
       WHERE student_id = $1 AND from_profile_doc
       ORDER BY position, id`,
      [studentId]
    );
    return items.rows;
  } finally {
    await pool.end();
  }
}

// The links importer, run in this process against the test DB (see
// test-db-env), with a
// synthetic workbook, Profile Doc export and summaries file for one Mentee.
async function reimport(key: string, actionItems: readonly { text: string; owner: string }[]) {
  const docUrl = LEGACY_CONVERSATION.profileDocUrl(key);
  const docId = profileDocId(docUrl)!;
  const workbook = new ExcelJS.Workbook();
  const docs = workbook.addWorksheet("Student Profile Docs");
  docs.addRow(["Student ID", "Profile Doc"]);
  docs.addRow([`E2E-BL-${key}`, { text: "Profile", hyperlink: docUrl }]);
  workbook.addWorksheet("Conversation").addRow(["Student ID", "Screener Form"]);
  const html = `<html><body><p class="title"><span>June</span></p><p>Jun 14, 2026: called</p><p>Synthetic.</p></body></html>`;
  return runBlendedLinksImport({
    workbook,
    mode: "apply",
    legacyProfileDocs: {
      readProfileDocHtml: (id) => (id === docId ? html : null),
      window: legacyDateWindow(new Date().toISOString().slice(0, 10)),
      conversations: parseLegacyConversations({
        [docId]: { occurredOn: LEGACY_CONVERSATION.occurredOn, summary: LEGACY_CONVERSATION.summary, actionItems },
      }),
    },
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

function openItems(page: Page) {
  return page.getByRole("region", { name: "Open Action Items" });
}

function profileDocEntry(page: Page) {
  return page.getByRole("region", { name: "History" }).getByRole("article").filter({ hasText: "From Profile Doc" });
}

// Every item's text starts at the same x, whatever its owner pill says.
async function expectAligned(rows: Locator) {
  const xs = await rows.evaluateAll((items) =>
    items.map((item) => Math.round((item.querySelector("span + span") as HTMLElement).getBoundingClientRect().x))
  );
  expect(xs.length).toBeGreaterThan(1);
  expect(new Set(xs).size).toBe(1);
}

async function expectProfileDocEntry(page: Page, profileDocUrl: string, statuses: RegExp[]) {
  const entry = profileDocEntry(page);
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("heading", { level: 3 })).toHaveText(/14 Jun/);
  await expect(entry).toContainText(LEGACY_CONVERSATION.summary);
  await expect(entry.getByRole("list", { name: "Action Items" }).getByRole("listitem")).toHaveText(statuses);
  await expect(entry.getByRole("checkbox")).toHaveCount(0);
  await expect(entry.getByRole("link", { name: "Open Profile Doc (opens in a new tab)" })).toHaveAttribute(
    "href",
    profileDocUrl
  );
}

for (const { label, key, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Profile Doc entry — ${label}`, () => {
    test.use({ viewport });
    const mentee = LEGACY_CONVERSATION_MENTEES[key];
    const profileDocUrl = LEGACY_CONVERSATION.profileDocUrl(mentee.key);

    test("Profile Doc items are open Action Items ticked from the log form; the entry is history, not a Conversation", async ({
      page,
    }) => {
      const studentId = studentIds[mentee.key];
      const detailPath = `/blended-learning/students/${studentId}`;
      const allOpen = LEGACY_CONVERSATION.actionItems.map((item) => new RegExp(`${item.text}Open$`));
      const afterTick = [/Open$/, /Done$/, /Open$/];

      // A view-only admin sees the same, read-only.
      await signInAs(page, BLENDED_ADMIN_READ_ONLY);
      await page.goto(detailPath);
      await expect(openItems(page).getByRole("listitem")).toHaveCount(3);
      await expect(openItems(page).getByRole("checkbox")).toHaveCount(0);
      await expectProfileDocEntry(page, profileDocUrl, allOpen);
      await expect(page.getByRole("button", { name: "Log conversation" })).toBeDisabled();

      // The Mentor: one Open Action Items block, no separate Profile Doc segment.
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(detailPath);
      await expect(page.getByRole("region", { name: /Profile Doc/ })).toHaveCount(0);
      const rows = openItems(page).getByRole("listitem");
      await expect(rows).toHaveCount(3);
      for (const item of LEGACY_CONVERSATION.actionItems) {
        await expect(rows.filter({ hasText: item.text })).toContainText("From Profile Doc · 14 Jun 2026");
      }
      await expectAligned(rows);
      const history = page.getByRole("region", { name: "History" });
      await expect(history.getByRole("heading", { level: 2 })).toHaveText("Conversations (0)");
      await expectProfileDocEntry(page, profileDocUrl, allOpen);
      await expectAligned(profileDocEntry(page).getByRole("listitem"));
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      // The log page: the entry is the Last Conversation; its items are ticked
      // in the form like any other.
      await page.getByRole("link", { name: "Log conversation", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${detailPath}/log$`));
      const last = page.getByRole("region", { name: "Last Conversation" });
      await expect(last).toContainText("From Profile Doc");
      await expect(last).toContainText(LEGACY_CONVERSATION.summary);
      await expect(last.getByRole("link", { name: "Open Profile Doc (opens in a new tab)" })).toHaveAttribute(
        "href",
        profileDocUrl
      );
      const logRows = openItems(page).getByRole("listitem");
      await expect(logRows).toHaveCount(3);
      await expect(logRows.first()).toContainText("From Profile Doc · 14 Jun 2026");
      await expectAligned(openItems(page).locator("label"));
      await openItems(page).getByRole("checkbox", { name: new RegExp(shareSchedule.text) }).check();
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      await form.getByLabel("Duration (minutes)").fill("20");
      await form.getByLabel("Summary").fill(`Synthetic ${key}: first call logged in the app.`);
      await form.getByRole("button", { name: "Save conversation" }).click();
      await expect(page.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Conversation saved" })).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await profileDocItems(studentId)).toEqual([
        { text: finishDpp.text, status: "open", closed: false },
        { text: shareSchedule.text, status: "done", closed: true },
        { text: hostelFee.text, status: "open", closed: false },
      ]);

      // The entry stays in the history; only the app's Conversation counts.
      await page.goto(detailPath);
      await expect(history.getByRole("heading", { level: 2 })).toHaveText("Conversations (1)");
      await expect(history.getByRole("article")).toHaveCount(2);
      await expectProfileDocEntry(page, profileDocUrl, afterTick);
      await expect(openItems(page).getByRole("listitem")).toHaveCount(2);
      await expect(openItems(page)).not.toContainText(shareSchedule.text);

      // A re-import keeps the done item, drops the open one the doc no longer
      // lists and adds the new one.
      const report = await reimport(mentee.key, [finishDpp, shareSchedule, NEW_ITEM]);
      expect(report.profileDocActionItems).toEqual({ inserted: 1, kept: 2, removed: 1 });
      expect(await profileDocItems(studentId)).toEqual([
        { text: finishDpp.text, status: "open", closed: false },
        { text: shareSchedule.text, status: "done", closed: true },
        { text: NEW_ITEM.text, status: "open", closed: false },
      ]);
      await page.reload();
      await expectProfileDocEntry(page, profileDocUrl, afterTick);
      await expect(openItems(page).getByRole("listitem")).toHaveCount(2);
      await expect(openItems(page)).toContainText(NEW_ITEM.text);
      await expect(openItems(page)).not.toContainText(hostelFee.text);
    });
  });
}
