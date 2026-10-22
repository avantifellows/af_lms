import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { BLENDED_MENTOR_C, FLAG_MENTEES } from "../helpers/blended-learning-fixtures";

// Mentor Flags on a Conversation (#447) against the real fixture DDL, with
// its one-flag-per-recipient unique index. SES is unconfigured in e2e, so an
// Emotional Well-being flag saves with no email and notification_sent_at
// stays null. Mentor C's FLAG_MENTEES exist only for this spec, one per
// viewport.
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

type FlagRow = {
  conversation_id: number;
  recipient: string;
  comment: string | null;
  raised_by_email: string;
  notified: boolean;
};

async function flagsOf(studentId: number): Promise<FlagRow[]> {
  return withPool(async (pool) => {
    const result = await pool.query<FlagRow>(
      `SELECT conversation_id::int AS conversation_id, recipient, comment, raised_by_email,
              (notification_sent_at IS NOT NULL) AS notified
       FROM blended_learning_mentor_flags
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

function detailPath(mentee: { key: string }) {
  return `/blended-learning/students/${studentIds[mentee.key]}`;
}

function historyEntryWith(page: Page, summary: string): Locator {
  return page.getByRole("region", { name: "History" }).getByRole("article").filter({ hasText: summary });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function fillConversation(form: Locator, summary: string) {
  await form.getByRole("radio", { name: "Call" }).check();
  await form.getByRole("radio", { name: "Student", exact: true }).check();
  await form.getByLabel("Duration (minutes)").fill("25");
  await form.getByLabel("Summary").fill(summary);
}

for (const { label, key, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Mentor Flags — ${label}`, () => {
    test.use({ viewport });
    const mentee = FLAG_MENTEES[key];

    test("a Conversation raises flags with comments and the detail page shows the chips", async ({ page }) => {
      const summary = `Synthetic ${key}: talked about exam stress.`;
      const wellbeingComment = `Synthetic ${key}: not sleeping before tests`;
      const mathsComment = `Synthetic ${key}: stuck on integration`;
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(`${detailPath(mentee)}/log`);

      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      await fillConversation(form, summary);

      const flags = form.getByRole("group", { name: "Mentor Flags (optional)" });
      await expect(flags.getByRole("switch")).toHaveCount(4);
      await expect(flags.getByRole("textbox")).toHaveCount(0);

      await flags.getByRole("switch", { name: "Emotional Well-being" }).check();
      await flags.getByLabel("Comment for Emotional Well-being (optional)").fill(wellbeingComment);
      await flags.getByRole("switch", { name: "Physics Teacher" }).check();
      await flags.getByRole("switch", { name: "Maths Teacher" }).check();
      await flags.getByLabel("Comment for Maths Teacher (optional)").fill(mathsComment);
      // Switched on, then off again: not raised.
      await flags.getByRole("switch", { name: "Chemistry Teacher" }).check();
      await flags.getByLabel("Comment for Chemistry Teacher (optional)").fill("Synthetic: changed my mind");
      await flags.getByRole("switch", { name: "Chemistry Teacher" }).uncheck();
      await expect(flags.getByLabel("Comment for Chemistry Teacher (optional)")).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await form.getByRole("button", { name: "Save Conversation" }).click();
      await expect(page.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Conversation saved" })).toBeVisible();

      const savedId = (await conversationIds(studentIds[mentee.key])).at(-1)!;
      const saved = (await flagsOf(studentIds[mentee.key])).filter((flag) => flag.conversation_id === savedId);
      expect(saved).toEqual([
        { conversation_id: savedId, recipient: "emotional_wellbeing", comment: wellbeingComment, raised_by_email: BLENDED_MENTOR_C.email, notified: false },
        { conversation_id: savedId, recipient: "physics", comment: null, raised_by_email: BLENDED_MENTOR_C.email, notified: false },
        { conversation_id: savedId, recipient: "maths", comment: mathsComment, raised_by_email: BLENDED_MENTOR_C.email, notified: false },
      ]);

      await page.goto(detailPath(mentee));
      const chips = historyEntryWith(page, summary).getByRole("list", { name: "Mentor Flags" }).getByRole("listitem");
      await expect(chips).toHaveText([
        `Emotional Well-being · ${wellbeingComment}`,
        "Physics Teacher",
        `Maths Teacher · ${mathsComment}`,
      ]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("the Attempt form offers no flags", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(`${detailPath(mentee)}/log`);
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      await expect(form.getByRole("switch", { name: "Emotional Well-being" })).toBeVisible();

      await form.getByRole("radio", { name: "Attempt" }).check();
      await expect(form.getByRole("switch")).toHaveCount(0);
    });
  });
}

test.describe("Blended Learning Mentor Flags — validation", () => {
  const mentee = FLAG_MENTEES.desktop;

  test("the same Flag Recipient twice returns 422 and saves nothing", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    const studentId = studentIds[mentee.key];
    const conversations = await conversationIds(studentId);
    const flags = await flagsOf(studentId);

    const res = await page.request.post(`/api/blended-learning/students/${studentId}/entries`, {
      data: {
        kind: "conversation",
        occurredOn: todayIST,
        mode: "call",
        spokeWith: "student",
        durationMinutes: 10,
        summary: "Synthetic: should not save.",
        flags: [{ recipient: "emotional_wellbeing" }, { recipient: "emotional_wellbeing", comment: "again" }],
      },
    });
    expect(res.status()).toBe(422);
    expect(await res.json()).toMatchObject({
      fieldErrors: { "flags.1.recipient": "Each Flag Recipient can be raised once." },
    });

    expect(await conversationIds(studentId)).toEqual(conversations);
    expect(await flagsOf(studentId)).toEqual(flags);
  });
});
