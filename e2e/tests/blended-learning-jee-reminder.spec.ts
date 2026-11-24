import { test, expect, signInAs } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";
import {
  BLENDED_MENTOR_C,
  JEE_REMINDER_MENTEES,
  programStudentId,
} from "../helpers/blended-learning-fixtures";

// The "JEE Form Filling (Reminder)" is ticked only by the JEE form (a
// Conversation can't), so it must never sit open for a Student already
// Filled. A push, first push and Push again alike, adds it done for a Student
// whose latest JEE form update is Filled, by that update; saving the same
// Filled form again ticks one left open. Against the real fixture DDL and the
// e2e DB Service stub (e2e/helpers/db-service-stub.mjs). JEE_REMINDER_MENTEES
// exist only for this spec, with no Mapping: it maps them to Mentor C, and
// afterwards removes the Common Action Items it pushed and ends those
// Mappings, so later specs see neither. The tests build on each other, so
// they run in order. Application numbers and passwords are synthetic.
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const TAB = "/blended-learning/jee-form";
// Not the fixture's "JEE Form Filling (Reminder)": the reminder is matched
// ignoring case, and this keeps its rows apart from the fixture's.
const REMINDER = "JEE form filling (reminder)";
// Any other Common Action Item is pushed open, Filled or not.
const OTHER_ITEM = "Synthetic: bring the admit card";
const PASSWORD = "e2e-reminder-pass-1";
const { push, pushAgain, raced } = JEE_REMINDER_MENTEES;
const ALL_MENTEES = [...Object.values(push), ...Object.values(pushAgain), raced];

type Mentee = { key: string };

const studentIds: Record<string, number> = {};
// The Common Action Items this spec pushes, removed again afterwards.
const commonIds: number[] = [];
let mentorCUserId = 0;

async function withPool<T>(fn: (pool: ReturnType<typeof getTestPool>) => Promise<T>): Promise<T> {
  const pool = getTestPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

const id = (mentee: Mentee) => studentIds[mentee.key];

// Active current-year Mappings to Mentor C, as the fixture seeds them.
async function mapToMentorC(mentees: Mentee[]) {
  await withPool((pool) =>
    pool.query(
      `INSERT INTO blended_learning_mentor_mentee_mappings
         (student_id, mentor_user_id, program_id, academic_year, started_at, assignment_source)
       SELECT st.id, $2, 80, $3, now() - interval '30 days', 'e2e_fixture'
       FROM student st WHERE st.id = ANY($1::bigint[])`,
      [mentees.map(id), mentorCUserId, CURRENT_ACADEMIC_YEAR]
    )
  );
}

test.beforeAll(async () => {
  await withPool(async (pool) => {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id = ANY($1::text[])`,
      [ALL_MENTEES.map(programStudentId)]
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
    const mentor = await pool.query<{ id: string }>(
      `SELECT user_id AS id FROM user_permission WHERE LOWER(email) = LOWER($1)`,
      [BLENDED_MENTOR_C.email]
    );
    mentorCUserId = Number(mentor.rows[0].id);
  });
  // The pushAgain set is mapped only after the first push.
  await mapToMentorC([...Object.values(push), raced]);
});

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await signInAs(await context.newPage(), BLENDED_ADMIN);
    // Removing deletes the still-open rows; the done ones stay as history.
    for (const commonId of commonIds) {
      expect((await page.request.delete(`/api/blended-learning/common-action-items/${commonId}`)).status()).toBe(200);
    }
  } finally {
    await context.close();
  }
  await withPool((pool) =>
    pool.query(
      `UPDATE blended_learning_mentor_mentee_mappings
       SET ended_at = GREATEST(started_at, date_trunc('second', now() AT TIME ZONE 'UTC')),
           ended_by_email = 'e2e-cleanup@example.com', end_source = 'e2e_cleanup', end_reason = 'e2e_cleanup'
       WHERE student_id = ANY($1::bigint[]) AND ended_at IS NULL`,
      [ALL_MENTEES.map(id)]
    )
  );
});

function jeeFormUrl(mentee: Mentee) {
  return `/api/blended-learning/students/${id(mentee)}/jee-form`;
}

async function recordFilled(page: Page, mentee: Mentee, applicationNumber: string) {
  const res = await page.request.post(jeeFormUrl(mentee), {
    multipart: { status: "filled", applicationNumber, password: PASSWORD },
  });
  expect(res.status()).toBe(201);
}

async function recordNotFilled(page: Page, mentee: Mentee) {
  const res = await page.request.post(jeeFormUrl(mentee), { multipart: { status: "not_filled", reasons: "not_aware" } });
  expect(res.status()).toBe(201);
}

type PushedRow = {
  student_id: number;
  status: string;
  completed_by_latest_update: boolean;
  completed_by_email: string | null;
  completed: boolean;
};

// Each Student's row of a Common Action Item, and whether a done one is done
// by the Student's latest JEE form update (the composite FK keeps it theirs).
async function pushedRows(commonId: number): Promise<PushedRow[]> {
  return withPool(async (pool) => {
    const result = await pool.query<PushedRow>(
      `SELECT item.student_id::int AS student_id, item.status,
              item.completed_by_jee_form_update_id IS NOT DISTINCT FROM (
                SELECT max(u.id) FROM blended_learning_jee_form_updates u WHERE u.student_id = item.student_id
              ) AND item.completed_by_jee_form_update_id IS NOT NULL AS completed_by_latest_update,
              item.completed_by_email,
              item.completed_at IS NOT NULL AS completed
       FROM blended_learning_action_items item
       WHERE item.common_action_item_id = $1
       ORDER BY item.student_id`,
      [commonId]
    );
    return result.rows;
  });
}

const DONE = { status: "done", completed_by_latest_update: true, completed_by_email: BLENDED_MENTOR_C.email, completed: true };
const OPEN = { status: "open", completed_by_latest_update: false, completed_by_email: null, completed: false };

// One push of a new Common Action Item to the listed Students, as an admin.
async function pushNew(page: Page, text: string, mentees: Mentee[]): Promise<{ id: number; added: number }> {
  const res = await page.request.post("/api/blended-learning/common-action-items", {
    data: { text, owner: "student", target: { kind: "students", studentIds: mentees.map(programStudentId).join(" ") } },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { id: number; added: number };
  commonIds.push(body.id);
  return body;
}

function row(page: Page, mentee: Mentee) {
  return page.locator(`#jee-student-${id(mentee)}`);
}

function openActionItems(page: Page) {
  return page.getByRole("region", { name: "Open Action Items" });
}

test.describe("Blended Learning JEE reminder — never left open for a Filled Student", () => {
  test.describe.configure({ mode: "serial" });
  const pushedTo = [...Object.values(push), ...Object.values(pushAgain)];
  let reminderId = 0;

  test("a push adds the reminder done for a Student already Filled, and open for Not filled or not recorded", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await recordFilled(page, push.filled, "E2E-JEE-REM-01");
    await recordNotFilled(page, push.notFilled);

    await signInAs(page, BLENDED_ADMIN);
    // Listed with the pushAgain set, which has no Mapping yet and so gets nothing now.
    const reminder = await pushNew(page, REMINDER, pushedTo);
    reminderId = reminder.id;
    expect(reminder.added).toBe(3);
    expect(await pushedRows(reminderId)).toEqual([
      { student_id: id(push.filled), ...DONE },
      { student_id: id(push.notFilled), ...OPEN },
      { student_id: id(push.notRecorded), ...OPEN },
    ]);

    // Any other Common Action Item is added open, Filled or not.
    const other = await pushNew(page, OTHER_ITEM, [push.filled, push.notFilled]);
    expect(await pushedRows(other.id)).toEqual([
      { student_id: id(push.filled), ...OPEN },
      { student_id: id(push.notFilled), ...OPEN },
    ]);

    // Manage counts the done one; the unmapped Students aren't targeted yet.
    // (A string hasText ignores case, so it would match the fixture's
    // reminder too.)
    await page.goto("/blended-learning/manage");
    const listed = page
      .getByRole("list", { name: "Program action items" })
      .getByRole("listitem")
      .filter({ hasText: /JEE form filling \(reminder\)/ });
    await expect(listed.locator("dd")).toHaveText(["2", "1"]);
  });

  test("the Filled Student's JEE tab row shows the reminder done, and the Mentee page doesn't list it as open", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await page.goto(`/blended-learning/students/${id(push.filled)}`);
    await expect(page.getByRole("region", { name: "JEE Main 2027 form" })).toContainText("Filled");
    await expect(openActionItems(page).getByText(OTHER_ITEM)).toBeVisible();
    await expect(openActionItems(page).getByText(REMINDER)).toHaveCount(0);

    // The Not filled Student's stays open, with the link to the tab.
    await page.goto(`/blended-learning/students/${id(push.notFilled)}`);
    const reminderItem = openActionItems(page).getByRole("listitem").filter({ hasText: REMINDER });
    await expect(reminderItem.getByRole("link", { name: "Fill in JEE tab" })).toBeVisible();

    // The Mentor's row opens on the form, prefilled; no open reminder to tick.
    await page.goto(`${TAB}?student=${id(push.filled)}`);
    const open = row(page, push.filled);
    await expect(open.getByRole("radio", { name: "Filled", exact: true })).toBeChecked();
    await expect(open.getByText(/Saving ticks the student's/)).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await open.getByRole("button", { name: "Save" }).click();
    await expect(open.getByRole("status")).toHaveText("Saved");
    // What is saved now shows, with the reminder done.
    await expect(open.getByText(REMINDER, { exact: true })).toHaveClass(/line-through/);
    await expect(open.getByText("Done", { exact: true })).toBeVisible();
    expect(await pushedRows(reminderId)).toContainEqual({ student_id: id(push.filled), ...DONE });
  });

  test("Push again adds it done for a newly mapped Filled Student, and open for the others", async ({ page }) => {
    await mapToMentorC(Object.values(pushAgain));
    await signInAs(page, BLENDED_MENTOR_C);
    await recordFilled(page, pushAgain.filled, "E2E-JEE-REM-04");
    await recordNotFilled(page, pushAgain.notFilled);
    // Filled after the push: saving Filled ticks the open reminder, as before.
    await recordFilled(page, push.notRecorded, "E2E-JEE-REM-03");

    await signInAs(page, BLENDED_ADMIN);
    const again = await page.request.post(`/api/blended-learning/common-action-items/${reminderId}/push`);
    expect(again.status()).toBe(200);
    expect((await again.json()).added).toBe(3);
    expect(await pushedRows(reminderId)).toEqual(
      [
        { student_id: id(push.filled), ...DONE },
        { student_id: id(push.notFilled), ...OPEN },
        { student_id: id(push.notRecorded), ...DONE },
        { student_id: id(pushAgain.filled), ...DONE },
        { student_id: id(pushAgain.notFilled), ...OPEN },
        { student_id: id(pushAgain.notRecorded), ...OPEN },
      ].sort((a, b) => a.student_id - b.student_id)
    );
  });

  test("a reminder left open for a Filled Student is ticked by saving the same form again in the JEE tab", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_C);
    await recordFilled(page, raced, "E2E-JEE-REM-07");
    // As a push that ran alongside that save would leave it: open, though Filled.
    await withPool((pool) =>
      pool.query(
        `INSERT INTO blended_learning_action_items (common_action_item_id, student_id, position, owner, text)
         SELECT common.id, $2, 1, common.owner, common.text FROM blended_learning_common_action_items common WHERE common.id = $1`,
        [reminderId, id(raced)]
      )
    );
    expect(await pushedRows(reminderId)).toContainEqual({ student_id: id(raced), ...OPEN });

    // Stuck before the fix: listed as open, and no tick reaches it.
    await page.goto(`/blended-learning/students/${id(raced)}`);
    await expect(openActionItems(page).getByText(REMINDER)).toBeVisible();

    await page.goto(`${TAB}?student=${id(raced)}`);
    const open = row(page, raced);
    await expect(open.getByRole("radio", { name: "Filled", exact: true })).toBeChecked();
    await expect(open.getByText(/Saving ticks the student's “JEE Form Filling \(Reminder\)” action item/)).toBeVisible();
    await page.waitForLoadState("networkidle");
    // The same number, no password, no PDF.
    const response = page.waitForResponse((res) => res.url().endsWith(jeeFormUrl(raced)));
    await open.getByRole("button", { name: "Save" }).click();
    const saved = await response;
    // Nothing new recorded, so 200; the form it returns shows the tick.
    expect(saved.status()).toBe(200);
    expect((await saved.json()).form.reminderItems).toEqual([
      { id: expect.any(Number), text: REMINDER, status: "done" },
    ]);
    await expect(open.getByRole("status")).toHaveText("Saved");
    await expect(open.getByText(REMINDER, { exact: true })).toHaveClass(/line-through/);
    await expect(open.getByText("Done", { exact: true })).toBeVisible();

    expect(await pushedRows(reminderId)).toContainEqual({ student_id: id(raced), ...DONE });
    const updates = await withPool(async (pool) =>
      (await pool.query(`SELECT count(*)::int AS count FROM blended_learning_jee_form_updates WHERE student_id = $1`, [id(raced)]))
        .rows[0].count
    );
    expect(updates).toBe(1);

    await page.goto(`/blended-learning/students/${id(raced)}`);
    await expect(page.getByRole("region", { name: "JEE Main 2027 form" })).toContainText("Filled");
    await expect(openActionItems(page).getByText(REMINDER)).toHaveCount(0);
  });

});
