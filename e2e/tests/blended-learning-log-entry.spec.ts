import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_C,
  LOGGING_LAST_CONVERSATION_DAYS_AGO,
  LOGGING_LAST_CONVERSATION_SUMMARY,
  LOGGING_MENTEES,
  OTHER_STUDENTS,
  fullName,
} from "../helpers/blended-learning-fixtures";

// Logging a Conversation or an Attempt by hand (#445) against the real
// fixture DDL. Mentor C's Mentees exist only for this spec, one set per
// viewport: "conversation" and "onBehalf" were never contacted; "attempt" had
// a Conversation LOGGING_LAST_CONVERSATION_DAYS_AGO IST days ago.
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};

const VIEWPORTS = [
  { label: "desktop", key: "desktop", viewport: { width: 1280, height: 800 }, entryRole: "row" },
  { label: "mobile 360", key: "mobile", viewport: { width: 360, height: 740 }, entryRole: "listitem" },
] as const;

const studentIds: Record<string, number> = {};
let todayIST: string;
let tomorrowIST: string;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id LIKE 'E2E-BL-%'`
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
    const dates = await pool.query<{ today: string; tomorrow: string }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS today,
              ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::text AS tomorrow`
    );
    todayIST = dates.rows[0].today;
    tomorrowIST = dates.rows[0].tomorrow;
  } finally {
    await pool.end();
  }
});

type SavedRow = {
  kind: string;
  occurred_on: string;
  mode: string | null;
  spoke_with: string | null;
  duration_minutes: number | null;
  summary: string | null;
  notes_html: string | null;
  attempt_note: string | null;
  logged_by_email: string;
  mapped_mentor_email: string;
};

async function savedEntries(studentId: number): Promise<SavedRow[]> {
  const pool = getTestPool();
  try {
    const result = await pool.query<SavedRow>(
      `SELECT c.kind, c.occurred_on::text AS occurred_on, c.mode, c.spoke_with, c.duration_minutes,
              c.summary, c.notes_html, c.attempt_note, c.logged_by_email,
              mentor.email AS mapped_mentor_email
       FROM blended_learning_conversations c
       JOIN "user" mentor ON mentor.id = c.mentor_user_id
       WHERE c.student_id = $1
       ORDER BY c.id`,
      [studentId]
    );
    return result.rows;
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

function historyEntries(page: Page): Locator {
  return page.getByRole("region", { name: "History" }).getByRole("article");
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function fillConversation(page: Page, fields: { duration: string; summary: string }) {
  const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
  await form.getByRole("radio", { name: "Call" }).check();
  await form.getByRole("radio", { name: "Student and parent" }).check();
  await form.getByLabel("Duration (minutes)").fill(fields.duration);
  await form.getByLabel("Summary").fill(fields.summary);
  return form;
}

for (const { label, key, viewport, entryRole } of VIEWPORTS) {
  test.describe(`Blended Learning logging — ${label}`, () => {
    test.use({ viewport });
    const mentees = LOGGING_MENTEES[key];

    function listEntry(page: Page, group: "Talk to First" | "Everyone else", mentee: { firstName: string; lastName: string }) {
      const section = page.getByRole("region", { name: group, exact: true });
      return section.getByRole(entryRole).filter({ hasText: fullName(mentee) });
    }

    test("a Mentor logs a Conversation and sees what the list now says", async ({ page }) => {
      const mentee = mentees.conversation;
      const summary = `Synthetic ${key}: talked about the mock test.`;
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(detailPath(mentee));
      await page.getByRole("link", { name: "Log a Conversation or Attempt" }).click();
      await expect(page).toHaveURL(new RegExp(`${logPath(mentee)}$`));

      const form = await fillConversation(page, { duration: "35", summary });
      await expect(form.getByLabel("Date")).toHaveValue(todayIST);

      // Notes: bold through the toolbar; tables are edited on desktop only.
      const notes = form.getByRole("textbox", { name: "Notes" });
      await notes.click();
      await form.getByRole("button", { name: "Bold" }).click();
      await page.keyboard.type("Revise optics");
      await form.getByRole("button", { name: "Bold" }).click();
      await page.keyboard.type(" by Friday");
      if (key === "desktop") {
        await expect(form.getByRole("button", { name: "Insert table" })).toBeVisible();
      } else {
        await expect(form.getByRole("button", { name: "Insert table" })).toBeHidden();
      }
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await form.getByRole("button", { name: "Save Conversation" }).click();

      const saved = page.getByRole("region", { name: "Saved" });
      await expect(saved.getByRole("heading", { name: "Conversation saved" })).toBeVisible();
      await expect(saved.getByText(`Your Mentee list now shows ${fullName(mentee)} in Everyone else`)).toBeVisible();
      await expect(saved.getByText("Today")).toBeVisible();
      await expect(saved.getByText("Never reached")).toHaveCount(0);

      expect(await savedEntries(studentIds[mentee.key])).toEqual([
        {
          kind: "conversation",
          occurred_on: todayIST,
          mode: "call",
          spoke_with: "both",
          duration_minutes: 35,
          summary,
          notes_html: "<p><b>Revise optics</b> by Friday</p>",
          attempt_note: null,
          logged_by_email: BLENDED_MENTOR_C.email,
          mapped_mentor_email: BLENDED_MENTOR_C.email,
        },
      ]);

      await saved.getByRole("link", { name: `View ${mentee.firstName}'s history` }).click();
      await expect(historyEntries(page).first()).toContainText(summary);

      await page.goto("/blended-learning");
      await expect(listEntry(page, "Everyone else", mentee)).toContainText("Today");
      await expect(listEntry(page, "Talk to First", mentee)).toHaveCount(0);
    });

    test("an Attempt moves the Mentee into Talk to First and keeps Last Contact", async ({ page }) => {
      const mentee = mentees.attempt;
      const lastContact = `${LOGGING_LAST_CONVERSATION_DAYS_AGO} days ago`;
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(logPath(mentee));

      // The last-conversation panel sits above the form on mobile, beside it on desktop.
      const panel = page.getByRole("region", { name: "Last Conversation" });
      await expect(panel).toContainText(LOGGING_LAST_CONVERSATION_SUMMARY);
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      const [panelBox, formBox] = [await panel.boundingBox(), await form.boundingBox()];
      if (key === "mobile") expect(panelBox!.y).toBeLessThan(formBox!.y);
      else expect(panelBox!.x).toBeGreaterThan(formBox!.x);

      await form.getByRole("radio", { name: "Attempt" }).check();
      await expect(form.getByLabel("Duration (minutes)")).toHaveCount(0);
      await form.getByLabel("Note (optional)").fill(`Synthetic ${key}: phone switched off.`);
      await form.getByRole("button", { name: "Save Attempt" }).click();

      const saved = page.getByRole("region", { name: "Saved" });
      await expect(saved.getByRole("heading", { name: "Attempt saved" })).toBeVisible();
      await expect(saved.getByText(`Your Mentee list now shows ${fullName(mentee)} in Talk to First`)).toBeVisible();
      await expect(saved.getByText("Last try didn't connect")).toBeVisible();
      await expect(saved.getByText(lastContact)).toBeVisible();

      const rows = await savedEntries(studentIds[mentee.key]);
      expect(rows.at(-1)).toMatchObject({
        kind: "attempt",
        occurred_on: todayIST,
        attempt_note: `Synthetic ${key}: phone switched off.`,
        logged_by_email: BLENDED_MENTOR_C.email,
      });

      await page.goto("/blended-learning");
      const row = listEntry(page, "Talk to First", mentee);
      await expect(row).toContainText("Last try didn't connect");
      await expect(row).toContainText(lastContact);
    });

    test("a future date and out-of-range durations are rejected with clear messages", async ({ page }) => {
      const mentee = mentees.conversation;
      await signInAs(page, BLENDED_MENTOR_C);
      await page.goto(logPath(mentee));
      const before = (await savedEntries(studentIds[mentee.key])).length;

      const form = await fillConversation(page, { duration: "0", summary: "Synthetic: should not save." });
      await form.getByLabel("Date").fill(tomorrowIST);
      await form.getByRole("button", { name: "Save Conversation" }).click();
      await expect(form.getByText("The date can't be in the future.")).toBeVisible();
      await expect(form.getByText("Duration must be between 1 and 240 minutes.")).toBeVisible();

      await form.getByLabel("Date").fill(todayIST);
      await form.getByLabel("Duration (minutes)").fill("241");
      await form.getByRole("button", { name: "Save Conversation" }).click();
      await expect(form.getByText("Duration must be between 1 and 240 minutes.")).toBeVisible();
      await expect(form.getByText("The date can't be in the future.")).toHaveCount(0);

      await form.getByRole("radio", { name: "Attempt" }).check();
      await form.getByLabel("Date").fill(tomorrowIST);
      await form.getByRole("button", { name: "Save Attempt" }).click();
      await expect(form.getByText("The date can't be in the future.")).toBeVisible();

      expect(await savedEntries(studentIds[mentee.key])).toHaveLength(before);
    });

    test("an admin logs on the Mentor's behalf", async ({ page }) => {
      const mentee = mentees.onBehalf;
      const summary = `Synthetic ${key}: admin logged a reported call.`;
      await signInAs(page, BLENDED_ADMIN);
      await page.goto(detailPath(mentee));
      await page.getByRole("link", { name: "Log a Conversation or Attempt" }).click();

      const form = await fillConversation(page, { duration: "20", summary });
      await form.getByRole("button", { name: "Save Conversation" }).click();
      await expect(page.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Conversation saved" })).toBeVisible();

      expect(await savedEntries(studentIds[mentee.key])).toEqual([
        expect.objectContaining({
          kind: "conversation",
          summary,
          mapped_mentor_email: BLENDED_MENTOR_C.email,
          logged_by_email: BLENDED_ADMIN.email,
        }),
      ]);
    });
  });
}

test.describe("Blended Learning logging — access", () => {
  test("a read-only admin sees no log entry point, and a direct POST is refused", async ({ page }) => {
    const mentee = LOGGING_MENTEES.desktop.attempt;
    await signInAs(page, BLENDED_ADMIN_READ_ONLY);
    await page.goto(detailPath(mentee));
    await expect(page.getByRole("heading", { name: fullName(mentee) })).toBeVisible();
    await expect(page.getByRole("link", { name: "Log a Conversation or Attempt" })).toHaveCount(0);

    await page.goto(logPath(mentee));
    await expect(page).toHaveURL(new RegExp(`${detailPath(mentee)}$`));

    const before = (await savedEntries(studentIds[mentee.key])).length;
    const response = await page.request.post(entriesUrl(mentee), {
      data: { kind: "attempt", occurredOn: todayIST },
    });
    expect(response.status()).toBe(403);
    expect(await savedEntries(studentIds[mentee.key])).toHaveLength(before);
  });

  test("a Mentor cannot log for another Mentor's Mentee", async ({ page }) => {
    const mentee = OTHER_STUDENTS.mentorB;
    await signInAs(page, BLENDED_MENTOR_A);
    // Tara already has the Flags feed's Conversations (#453).
    const before = (await savedEntries(studentIds[mentee.key])).length;

    const response = await page.request.post(entriesUrl(mentee), {
      data: { kind: "attempt", occurredOn: todayIST },
    });
    expect(response.status()).toBe(404);
    expect(await savedEntries(studentIds[mentee.key])).toHaveLength(before);

    const page404 = await page.goto(logPath(mentee));
    expect(page404?.status()).toBe(404);
  });
});
