import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_C,
  SCREENER_MENTEES,
  SCREENER_RACE_MENTEE,
  fullName,
} from "../helpers/blended-learning-fixtures";

// "Was the screener form used?" on the log form, and the once-per-Student
// Screener Feedback, against the real fixture DDL. Mentor C's Screener
// Mentees exist only for this spec, one pair per viewport: "withLink" has a
// Screener link, "noLink" has none. The tests in a viewport build on each
// other, so they run in order.
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};

const QUESTION = "Was the screener form used?";
const HELPED = "Did the screener help you understand this student better?";
const COMFORTABLE = "Did the student seem more comfortable talking to you than before?";

const VIEWPORTS = [
  { label: "desktop", key: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", key: "mobile", viewport: { width: 360, height: 740 } },
] as const;

const studentIds: Record<string, number> = {};
let todayIST: string;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id LIKE 'E2E-BL-J%'`
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
    const dates = await pool.query<{ today: string }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS today`
    );
    todayIST = dates.rows[0].today;
  } finally {
    await pool.end();
  }
});

type SavedEntry = { kind: string; summary: string | null; screener_used: boolean | null };
type SavedFeedback = {
  conversation_summary: string;
  mentor_email: string;
  helped_understand: number;
  more_comfortable: number;
};

async function saved(studentId: number): Promise<{ entries: SavedEntry[]; feedback: SavedFeedback[] }> {
  const pool = getTestPool();
  try {
    const entries = await pool.query<SavedEntry>(
      `SELECT kind, summary, screener_used FROM blended_learning_conversations WHERE student_id = $1 ORDER BY id`,
      [studentId]
    );
    const feedback = await pool.query<SavedFeedback>(
      `SELECT c.summary AS conversation_summary, mentor.email AS mentor_email,
              feedback.helped_understand, feedback.more_comfortable
       FROM blended_learning_screener_feedback feedback
       JOIN blended_learning_conversations c ON c.id = feedback.conversation_id
       JOIN "user" mentor ON mentor.id = feedback.mentor_user_id
       WHERE feedback.student_id = $1`,
      [studentId]
    );
    return { entries: entries.rows, feedback: feedback.rows };
  } finally {
    await pool.end();
  }
}

function detailPath(mentee: { key: string }) {
  return `/blended-learning/students/${studentIds[mentee.key]}`;
}

function logPath(mentee: { key: string }) {
  return `${detailPath(mentee)}/log`;
}

function entriesUrl(mentee: { key: string }) {
  return `/api/blended-learning/students/${studentIds[mentee.key]}/entries`;
}

function logForm(page: Page): Locator {
  return page.getByRole("form", { name: "Log a Conversation or Attempt" });
}

function historyEntries(page: Page): Locator {
  return page.getByRole("region", { name: "History" }).getByRole("article");
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function fillConversation(page: Page, summary: string): Promise<Locator> {
  const form = logForm(page);
  await form.getByLabel("Duration (minutes)").fill("25");
  await form.getByLabel("Summary").fill(summary);
  return form;
}

async function savedConfirmation(page: Page) {
  await expect(page.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Conversation saved" })).toBeVisible();
}

// The answers under each question, as the history shows them.
async function historyRatings(entry: Locator): Promise<string[][]> {
  const terms = await entry.getByRole("term").allTextContents();
  const definitions = await entry.getByRole("definition").allTextContents();
  return terms.map((term, index) => [term, definitions[index]]);
}

const conversation = (summary: string) => ({
  kind: "conversation",
  occurredOn: todayIST,
  mode: "call",
  spokeWith: "student",
  durationMinutes: 20,
  summary,
});

for (const { label, key, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Screener Feedback — ${label}`, () => {
    test.describe.configure({ mode: "serial" });
    test.use({ viewport });
    const { withLink, noLink } = SCREENER_MENTEES[key];
    const firstSummary = `Synthetic ${key}: went through the screener answers.`;
    const secondSummary = `Synthetic ${key}: looked at the screener again.`;

    test("no checkbox for a Student without a Screener link; the Conversation saves screener_used NULL", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(logPath(noLink));
      const form = await fillConversation(page, `Synthetic ${key}: no screener here.`);
      await expect(form.getByRole("checkbox", { name: QUESTION })).toHaveCount(0);
      await form.getByRole("button", { name: "Save conversation" }).click();
      await savedConfirmation(page);

      expect(await saved(studentIds[noLink.key])).toEqual({
        entries: [{ kind: "conversation", summary: `Synthetic ${key}: no screener here.`, screener_used: null }],
        feedback: [],
      });
      await page.goto(detailPath(noLink));
      await expect(historyEntries(page).first()).not.toContainText("Screener form used");
    });

    test("a first tick asks the two required questions, and the ratings show in the history", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(logPath(withLink));
      const form = await fillConversation(page, firstSummary);
      const checkbox = form.getByRole("checkbox", { name: QUESTION });
      await expect(checkbox).not.toBeChecked();
      await expect(form.getByRole("region", { name: "Screener feedback" })).toHaveCount(0);

      await checkbox.check();
      const feedback = form.getByRole("region", { name: "Screener feedback" });
      const helped = feedback.getByRole("group", { name: HELPED });
      const comfortable = feedback.getByRole("group", { name: COMFORTABLE });
      await expect(helped.getByRole("radio")).toHaveCount(5);
      const save = form.getByRole("button", { name: "Save conversation" });
      await expect(save).toBeDisabled();
      await expect(form.getByText("To save, fill in: Screener ratings.")).toBeVisible();

      // Arrow keys move within one scale, as a native radio group.
      await helped.getByRole("radio", { name: "3" }).check();
      await page.keyboard.press("ArrowRight");
      await expect(helped.getByRole("radio", { name: "4" })).toBeChecked();
      await expect(save).toBeDisabled();
      await comfortable.getByRole("radio", { name: "5, A lot" }).check();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expect(save).toBeEnabled();
      await save.click();
      await savedConfirmation(page);

      expect(await saved(studentIds[withLink.key])).toEqual({
        entries: [{ kind: "conversation", summary: firstSummary, screener_used: true }],
        feedback: [
          {
            conversation_summary: firstSummary,
            mentor_email: BLENDED_MENTOR_C.email,
            helped_understand: 4,
            more_comfortable: 5,
          },
        ],
      });

      await page.goto(detailPath(withLink));
      const entry = historyEntries(page).first();
      await expect(entry).toContainText(firstSummary);
      await expect(entry.getByText("Screener form used")).toBeVisible();
      expect(await historyRatings(entry)).toEqual([
        [HELPED, "4 / 5"],
        [COMFORTABLE, "5 / 5"],
      ]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("a later tick saves screener_used without asking again, and ratings are refused", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(logPath(withLink));
      const form = await fillConversation(page, secondSummary);
      await form.getByRole("checkbox", { name: QUESTION }).check();
      await expect(form.getByRole("region", { name: "Screener feedback" })).toHaveCount(0);
      await form.getByRole("button", { name: "Save conversation" }).click();
      await savedConfirmation(page);

      // Ratings now, or with the box unticked, are refused and save nothing.
      const given = await page.request.post(entriesUrl(withLink), {
        data: { ...conversation("Synthetic: too late."), screenerUsed: true, screenerFeedback: { helpedUnderstand: 1, moreComfortable: 1 } },
      });
      expect(given.status()).toBe(409);
      expect((await given.json()).fieldErrors).toEqual({ screenerFeedback: expect.stringContaining("already saved") });
      const unticked = await page.request.post(entriesUrl(withLink), {
        data: { ...conversation("Synthetic: unticked."), screenerUsed: false, screenerFeedback: { helpedUnderstand: 1, moreComfortable: 1 } },
      });
      expect(unticked.status()).toBe(422);
      const noAnswer = await page.request.post(entriesUrl(withLink), { data: conversation("Synthetic: no answer.") });
      expect(noAnswer.status()).toBe(422);

      expect(await saved(studentIds[withLink.key])).toMatchObject({
        entries: [
          { summary: firstSummary, screener_used: true },
          { summary: secondSummary, screener_used: true },
        ],
        feedback: [{ conversation_summary: firstSummary, helped_understand: 4, more_comfortable: 5 }],
      });

      await page.goto(detailPath(withLink));
      const [latest, first] = [historyEntries(page).nth(0), historyEntries(page).nth(1)];
      await expect(latest).toContainText(secondSummary);
      await expect(latest.getByText("Screener form used")).toBeVisible();
      await expect(latest.getByRole("term")).toHaveCount(0);
      await expect(first.getByRole("term")).toHaveCount(2);
    });

    test("an Attempt has no checkbox and saves screener_used NULL", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(logPath(withLink));
      const form = logForm(page);
      await expect(form.getByRole("checkbox", { name: QUESTION })).toBeVisible();
      await form.getByRole("radio", { name: "Attempt" }).check();
      await expect(form.getByRole("checkbox", { name: QUESTION })).toHaveCount(0);
      await form.getByRole("button", { name: "Log attempt" }).click();
      await expect(page.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Attempt logged" })).toBeVisible();

      const { entries } = await saved(studentIds[withLink.key]);
      expect(entries.at(-1)).toEqual({ kind: "attempt", summary: null, screener_used: null });
      const attempt = await page.request.post(entriesUrl(withLink), {
        data: { kind: "attempt", occurredOn: todayIST, screenerUsed: false },
      });
      expect(attempt.status()).toBe(422);
    });

    test("a read-only admin sees the screener use and ratings, with nothing to change", async ({ page }) => {
      await signInAs(page, BLENDED_ADMIN_READ_ONLY);
      await page.goto(detailPath(withLink));
      await expect(page.getByRole("heading", { name: fullName(withLink) })).toBeVisible();
      await expect(page.getByRole("link", { name: "Log conversation", exact: true })).toHaveCount(0);

      const first = historyEntries(page).filter({ hasText: firstSummary });
      await expect(first.getByText("Screener form used")).toBeVisible();
      expect(await historyRatings(first)).toEqual([
        [HELPED, "4 / 5"],
        [COMFORTABLE, "5 / 5"],
      ]);
      const history = page.getByRole("region", { name: "History" });
      await expect(history.getByRole("checkbox")).toHaveCount(0);
      await expect(history.getByRole("radio")).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("Blended Learning Screener Feedback — two saves at once", () => {
  test("only one gives the Student's feedback; the other is a 409 and saves nothing", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    const post = (n: number) =>
      page.request.post(entriesUrl(SCREENER_RACE_MENTEE), {
        data: {
          ...conversation(`Synthetic: racing save ${n}.`),
          screenerUsed: true,
          screenerFeedback: { helpedUnderstand: n, moreComfortable: n },
        },
      });

    const statuses = (await Promise.all([post(2), post(3)])).map((response) => response.status()).sort();

    expect(statuses).toEqual([201, 409]);
    const { entries, feedback } = await saved(studentIds[SCREENER_RACE_MENTEE.key]);
    expect(entries).toHaveLength(1);
    expect(feedback).toEqual([
      expect.objectContaining({ conversation_summary: entries[0].summary, mentor_email: BLENDED_MENTOR_C.email }),
    ]);
  });
});
