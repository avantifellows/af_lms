import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  ACTION_ITEM_MENTEES,
  BLENDED_MENTOR_C,
  EARLIER_ACTION_ITEMS,
  IRA_HISTORY,
  MENTEES,
  fullName,
} from "../helpers/blended-learning-fixtures";

// Action Items on a Conversation (#446) against the real fixture DDL and its
// open → done trigger. Mentor C's ACTION_ITEM_MENTEES exist only for this
// spec, one per viewport. Each has an earlier Conversation with two open
// Action Items (toTick, stayOpen) and one already done.
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};

const VIEWPORTS = [
  { label: "desktop", key: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", key: "mobile", viewport: { width: 360, height: 740 } },
] as const;

const studentIds: Record<string, number> = {};
let todayIST: string;

async function withPool<T>(fn: (pool: ReturnType<typeof getTestPool>) => Promise<T>): Promise<T> {
  const pool = getTestPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

test.beforeAll(async () => {
  await withPool(async (pool) => {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id LIKE 'E2E-BL-%'`
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
    const dates = await pool.query<{ today: string }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS today`
    );
    todayIST = dates.rows[0].today;
  });
});

type ActionItemRow = {
  id: number;
  conversation_id: number;
  position: number;
  text: string;
  owner: string;
  due_on: string | null;
  status: string;
  completed_by_conversation_id: number | null;
  completed_by_email: string | null;
  completed: boolean;
};

async function actionItems(studentId: number): Promise<ActionItemRow[]> {
  return withPool(async (pool) => {
    const result = await pool.query<ActionItemRow>(
      `SELECT id::int AS id, conversation_id::int AS conversation_id, position, text, owner,
              due_on::text AS due_on, status, completed_by_conversation_id::int AS completed_by_conversation_id,
              completed_by_email, (completed_at IS NOT NULL) AS completed
       FROM blended_learning_action_items
       WHERE student_id = $1
       ORDER BY id`,
      [studentId]
    );
    return result.rows;
  });
}

async function conversationIds(studentId: number): Promise<number[]> {
  return withPool(async (pool) => {
    const result = await pool.query<{ id: number }>(
      `SELECT id::int AS id FROM blended_learning_conversations WHERE student_id = $1 ORDER BY id`,
      [studentId]
    );
    return result.rows.map((row) => row.id);
  });
}

function itemByText(rows: ActionItemRow[], text: string): ActionItemRow {
  const row = rows.find((item) => item.text === text);
  if (!row) throw new Error(`Action Item "${text}" is missing`);
  return row;
}

function detailPath(mentee: { key: string }) {
  return `/blended-learning/students/${studentIds[mentee.key]}`;
}

function entriesUrl(mentee: { key: string }) {
  return `/api/blended-learning/students/${studentIds[mentee.key]}/entries`;
}

function historyEntryWith(page: Page, summary: string): Locator {
  return page.getByRole("region", { name: "History" }).getByRole("article").filter({ hasText: summary });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

const { toTick, stayOpen, done } = EARLIER_ACTION_ITEMS;

for (const { label, key, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Action Items — ${label}`, () => {
    test.use({ viewport });
    const mentee = ACTION_ITEM_MENTEES[key];

    test("a Conversation fills the two starter Action Item rows and ticks an earlier one done", async ({ page }) => {
      const summary = `Synthetic ${key}: reviewed last week's follow-ups.`;
      const first = `Synthetic ${key}: revise organic chemistry`;
      const second = `Synthetic ${key}: send the fee receipt`;
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(`${detailPath(mentee)}/log`);

      // Open items from earlier Conversations: above the form on mobile, beside it on desktop.
      const panel = page.getByRole("region", { name: "Open Action Items" });
      await expect(panel.getByRole("checkbox")).toHaveCount(2);
      await expect(panel).toContainText(toTick.text);
      await expect(panel).toContainText(stayOpen.text);
      await expect(panel).not.toContainText(done.text);
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      const [panelBox, formBox] = [await panel.boundingBox(), await form.boundingBox()];
      if (key === "mobile") expect(panelBox!.y).toBeLessThan(formBox!.y);
      else expect(panelBox!.x).toBeGreaterThan(formBox!.x);

      await form.getByRole("radio", { name: "Call" }).check();
      await form.getByRole("radio", { name: "Student", exact: true }).check();
      await form.getByLabel("Duration (minutes)").fill("30");
      await form.getByLabel("Summary").fill(summary);

      // A new log opens with a blank Student row and a blank Mentor row.
      const items = form.getByRole("group", { name: "Action items" });
      await expect(items.getByLabel("Who does action item 1", { exact: true })).toHaveValue("student");
      await expect(items.getByLabel("Who does action item 2", { exact: true })).toHaveValue("mentor");
      await expect(items.getByLabel("Action item 3", { exact: true })).toHaveCount(0);
      await items.getByLabel("Action item 1", { exact: true }).fill(first);
      // Action Items take no due date.
      await expect(items.getByLabel(/Due/)).toHaveCount(0);
      await items.getByLabel("Who does action item 2", { exact: true }).selectOption({ label: "Parent" });
      await items.getByLabel("Action item 2", { exact: true }).fill(second);
      // Each row's controls are tap-sized.
      for (const control of [
        items.getByLabel("Who does action item 1", { exact: true }),
        items.getByLabel("Action item 1", { exact: true }),
        items.getByRole("button", { name: "Remove action item 1" }),
        items.getByRole("button", { name: "Add an action" }),
      ]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }

      await panel.getByRole("checkbox", { name: new RegExp(toTick.text) }).check();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await form.getByRole("button", { name: "Save conversation" }).click();
      const saved = page.getByRole("region", { name: "Saved" });
      await expect(saved.getByRole("heading", { name: "Conversation saved" })).toBeVisible();
      await expect(saved.getByText("Action items added")).toBeVisible();
      await expect(saved.getByText("Action items closed")).toBeVisible();

      const savedId = (await conversationIds(studentIds[mentee.key])).at(-1)!;
      const rows = await actionItems(studentIds[mentee.key]);
      expect(rows.filter((row) => row.conversation_id === savedId)).toEqual([
        expect.objectContaining({ position: 1, owner: "student", text: first, due_on: null, status: "open" }),
        expect.objectContaining({ position: 2, owner: "parent", text: second, due_on: null, status: "open" }),
      ]);
      expect(itemByText(rows, toTick.text)).toMatchObject({
        status: "done",
        completed_by_conversation_id: savedId,
        completed_by_email: BLENDED_MENTOR_C.email,
        completed: true,
      });
      expect(itemByText(rows, stayOpen.text)).toMatchObject({ status: "open", completed_by_conversation_id: null });

      // Detail: the new items are open; the earlier one is done.
      await page.goto(detailPath(mentee));
      const newItems = historyEntryWith(page, summary).getByRole("list", { name: "Action Items" }).getByRole("listitem");
      // Owner pill, then the text, then its status; Action Items show no due date.
      await expect(newItems).toHaveText([new RegExp(`^Student\\s*${first}\\s*Open$`), new RegExp(`^Parent\\s*${second}\\s*Open$`)]);
      const earlierItems = historyEntryWith(page, "Synthetic: agreed the revision plan.")
        .getByRole("list", { name: "Action Items" })
        .getByRole("listitem");
      await expect(earlierItems).toHaveText([
        new RegExp(`${toTick.text}.*Done`),
        new RegExp(`${stayOpen.text}.*Open`),
        new RegExp(`${done.text}.*Done`),
      ]);

      const open = page.getByRole("region", { name: "Open Action Items" });
      await expect(open.getByRole("listitem")).toHaveText([
        new RegExp(first),
        new RegExp(second),
        new RegExp(stayOpen.text),
      ]);
      await expect(open.getByRole("checkbox")).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("the Attempt form offers no tick or add controls", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(`${detailPath(mentee)}/log`);
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      const panel = page.getByRole("region", { name: "Open Action Items" });
      await expect(panel.getByRole("checkbox").first()).toBeVisible();

      await form.getByRole("radio", { name: "Attempt" }).check();
      await expect(panel).toContainText(stayOpen.text);
      await expect(panel).toContainText("Only a Conversation can tick these done.");
      await expect(panel.getByRole("checkbox")).toHaveCount(0);
      await expect(form.getByRole("button", { name: "Add an action" })).toHaveCount(0);
    });

    test("Action Item rows left blank are not saved", async ({ page }) => {
      const summary = `Synthetic ${key}: quick check-in, nothing new agreed.`;
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(`${detailPath(mentee)}/log`);
      const before = await actionItems(studentIds[mentee.key]);

      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      await form.getByLabel("Duration (minutes)").fill("15");
      await form.getByLabel("Summary").fill(summary);
      // The two starter rows plus an added one, all blank.
      await form.getByRole("button", { name: "Add an action" }).click();
      await expect(form.getByLabel("Who does action item 3", { exact: true })).toHaveValue("student");
      await form.getByRole("button", { name: "Save conversation" }).click();
      await expect(page.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Conversation saved" })).toBeVisible();

      const savedId = (await conversationIds(studentIds[mentee.key])).at(-1)!;
      const after = await actionItems(studentIds[mentee.key]);
      expect(after.filter((row) => row.conversation_id === savedId)).toEqual([]);
      expect(after).toHaveLength(before.length);
    });
  });
}

test.describe("Blended Learning Action Items — conflicts and access", () => {
  const mentee = ACTION_ITEM_MENTEES.desktop;
  const conversation = (completeActionItemIds: number[]) => ({
    kind: "conversation",
    occurredOn: todayIST,
    mode: "call",
    spokeWith: "student",
    durationMinutes: 20,
    summary: "Synthetic: should roll back.",
    actionItems: [{ owner: "mentor", text: "Synthetic: should roll back too" }],
    completeActionItemIds,
  });

  test("ticking a done item, or another Student's, returns 409 and nothing from that save persists", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    const studentId = studentIds[mentee.key];
    const items = await actionItems(studentId);
    const conversations = await conversationIds(studentId);

    // An open item ticked alongside a done one is rolled back with it.
    const alreadyDone = await page.request.post(entriesUrl(mentee), {
      data: conversation([itemByText(items, stayOpen.text).id, itemByText(items, done.text).id]),
    });
    expect(alreadyDone.status()).toBe(409);

    const ira = studentIds[MENTEES.attemptLatest.key];
    const iraOpen = itemByText(await actionItems(ira), IRA_HISTORY.conversation20.actionItems.open);
    const otherStudents = await page.request.post(entriesUrl(mentee), { data: conversation([iraOpen.id]) });
    expect(otherStudents.status()).toBe(409);

    expect(await conversationIds(studentId)).toEqual(conversations);
    expect(await actionItems(studentId)).toEqual(items);
    expect(itemByText(await actionItems(ira), iraOpen.text)).toMatchObject({ status: "open", completed: false });
  });

  test("an Attempt with Action Items or ticks is rejected", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    const studentId = studentIds[mentee.key];
    const items = await actionItems(studentId);
    const conversations = await conversationIds(studentId);

    const withItems = await page.request.post(entriesUrl(mentee), {
      data: { kind: "attempt", occurredOn: todayIST, actionItems: [{ owner: "mentor", text: "Synthetic: call back" }] },
    });
    expect(withItems.status()).toBe(422);
    const withTicks = await page.request.post(entriesUrl(mentee), {
      data: { kind: "attempt", occurredOn: todayIST, completeActionItemIds: [itemByText(items, stayOpen.text).id] },
    });
    expect(withTicks.status()).toBe(422);

    expect(await conversationIds(studentId)).toEqual(conversations);
    expect(await actionItems(studentId)).toEqual(items);
  });

  test("a read-only admin sees the open items but no tick or add controls", async ({ page }) => {
    await signInAs(page, BLENDED_ADMIN_READ_ONLY);
    await page.goto(detailPath(mentee));
    await expect(page.getByRole("heading", { name: fullName(mentee) })).toBeVisible();

    const open = page.getByRole("region", { name: "Open Action Items" });
    await expect(open).toContainText(stayOpen.text);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add an action" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Log conversation", exact: true })).toHaveCount(0);
  });
});
