import { test, expect, signInAs } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_D,
  MANAGE_MENTEES,
} from "../helpers/blended-learning-fixtures";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";

// The admin Manage page against the real fixture DDL (db-service
// 20261027120000): Resources, and Common Action Items pushed to Mentor D's
// MANAGE_MENTEES, which exist only for this spec. Resources this spec adds are
// removed again, so the seeded Mentor Toolkit is the only one left for later
// specs.
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const READ_ONLY_ADMIN = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const TOOLKIT = "Mentor Toolkit: Supporting Students Through Non-Academic Stress";

const studentIds: Record<string, number> = {};
let mentorDUserId = 0;

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
      `SELECT student_id, id FROM student WHERE student_id LIKE 'E2E-BL-H%'`
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
    const mentor = await pool.query<{ id: string }>(
      `SELECT user_id AS id FROM user_permission WHERE LOWER(email) = LOWER($1)`,
      [BLENDED_MENTOR_D.email]
    );
    mentorDUserId = Number(mentor.rows[0].id);
  });
});

type PushedRow = {
  student_id: number;
  conversation_id: number | null;
  text: string;
  owner: string;
  status: string;
  completed_by_conversation_id: number | null;
  completed_by_email: string | null;
};

async function pushedRows(text: RegExp | null = null): Promise<PushedRow[]> {
  return withPool(async (pool) => {
    const result = await pool.query<PushedRow>(
      `SELECT item.student_id::int AS student_id, item.conversation_id::int AS conversation_id, item.text,
              item.owner, item.status, item.completed_by_conversation_id::int AS completed_by_conversation_id,
              item.completed_by_email
       FROM blended_learning_action_items item
       WHERE item.common_action_item_id IS NOT NULL AND item.student_id = ANY($1::bigint[])
       ORDER BY item.student_id`,
      [Object.values(studentIds)]
    );
    return text ? result.rows.filter((row) => text.test(row.text)) : result.rows;
  });
}

async function resourceTitles(): Promise<string[]> {
  return withPool(async (pool) => {
    const result = await pool.query<{ title: string }>(
      `SELECT title FROM blended_learning_resources ORDER BY position, id`
    );
    return result.rows.map((row) => row.title);
  });
}

function resourceList(page: Page) {
  return page.getByRole("list", { name: "Resources" }).getByRole("listitem");
}

function commonItem(page: Page, text: string) {
  return page.getByRole("list", { name: "Program action items" }).getByRole("listitem").filter({ hasText: text });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openManage(page: Page) {
  await page.goto("/blended-learning");
  await page.getByRole("navigation", { name: "Admin views" }).getByRole("link", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/blended-learning\/manage$/);
  await expect(page.getByRole("heading", { level: 2, name: "Program action items" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("Blended Learning Manage — access", () => {
  test("a Mentor gets no Manage tab, is sent away from the page and gets 403 from every Manage API", async ({ page }) => {
    await signInAs(page, BLENDED_MENTOR_A);
    await page.goto("/blended-learning");
    const tabs = page.getByRole("navigation", { name: "Mentor views" });
    await expect(tabs.getByRole("link", { name: "Resources" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Manage" })).toHaveCount(0);

    await page.goto("/blended-learning/manage");
    await expect(page).toHaveURL(/\/blended-learning$/);

    const json = { title: "Synthetic: nope", url: "https://example.org/nope" };
    const calls = [
      page.request.post("/api/blended-learning/resources", { data: json }),
      page.request.patch("/api/blended-learning/resources/1", { data: json }),
      page.request.delete("/api/blended-learning/resources/1"),
      page.request.post("/api/blended-learning/resources/1/move", { data: { direction: "down" } }),
      page.request.post("/api/blended-learning/common-action-items/preview", { data: { kind: "all" } }),
      page.request.post("/api/blended-learning/common-action-items", {
        data: { text: "Synthetic: nope", owner: "student", target: { kind: "all" } },
      }),
      page.request.patch("/api/blended-learning/common-action-items/1", { data: { text: "x", owner: "student" } }),
      page.request.delete("/api/blended-learning/common-action-items/1"),
      page.request.post("/api/blended-learning/common-action-items/1/push"),
    ];
    for (const response of await Promise.all(calls)) expect(response.status()).toBe(403);
    expect(await resourceTitles()).toEqual([TOOLKIT]);
  });

  test("a read-only admin gets no Manage tab and 403 on writes", async ({ page }) => {
    await signInAs(page, READ_ONLY_ADMIN);
    await page.goto("/blended-learning/resources");
    await expect(page.getByRole("navigation", { name: "Admin views" }).getByRole("link", { name: "Manage" })).toHaveCount(0);
    await page.goto("/blended-learning/manage");
    await expect(page).toHaveURL(/\/blended-learning$/);
    const response = await page.request.post("/api/blended-learning/resources", {
      data: { title: "Synthetic: nope", url: "https://example.org/nope" },
    });
    expect(response.status()).toBe(403);
  });

  test("an LMS admin manages from inside the dashboard", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");
    await adminPage.getByRole("link", { name: "Blended Learning", exact: true }).first().click();
    await openManage(adminPage);
    await expect(adminPage.getByRole("banner").getByRole("img", { name: "Avanti Fellows" })).toBeVisible();
    await expect(resourceList(adminPage)).toHaveCount(1);
  });
});

test.describe("Blended Learning Manage — Resources", () => {
  const stress = { title: "Synthetic: exam stress guide", url: "https://example.org/e2e-stress" };
  const planner = { title: "Synthetic: revision planner", url: "https://example.org/e2e-planner" };
  const renamed = "Synthetic: weekly revision planner";

  test("an admin adds, edits, reorders and removes Resources, and Mentors see them in order", async ({ page, browser }) => {
    await signInAs(page, BLENDED_ADMIN);
    await openManage(page);
    const add = page.getByRole("form", { name: "Add a resource" });

    // Checked inline, nothing saved.
    await add.getByLabel("Title").fill("   ");
    await add.getByLabel("Link").fill("http://example.org/insecure");
    await add.getByRole("button", { name: "Add resource" }).click();
    await expect(add.getByText("Enter a title.")).toBeVisible();
    await expect(add.getByText("Enter a full link starting with https://")).toBeVisible();
    expect(await resourceTitles()).toEqual([TOOLKIT]);

    for (const resource of [stress, planner]) {
      await add.getByLabel("Title").fill(resource.title);
      await add.getByLabel("Link").fill(resource.url);
      await add.getByRole("button", { name: "Add resource" }).click();
      await expect(resourceList(page).filter({ hasText: resource.title })).toHaveCount(1);
      await expect(add.getByLabel("Title")).toHaveValue("");
    }
    await expect(resourceList(page)).toHaveCount(3);

    await page.getByRole("button", { name: `Edit ${planner.title}` }).click();
    const edit = page.getByRole("form", { name: `Edit ${planner.title}` });
    await edit.getByLabel("Title").fill(renamed);
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("link", { name: `${renamed} (opens in a new tab)` })).toBeVisible();

    await page.getByRole("button", { name: `Move ${renamed} up` }).click();
    await expect(resourceList(page)).toHaveText([new RegExp(TOOLKIT), new RegExp(renamed), new RegExp(stress.title)]);
    await expect(page.getByRole("button", { name: `Move ${TOOLKIT} up` })).toBeDisabled();
    expect(await resourceTitles()).toEqual([TOOLKIT, renamed, stress.title]);

    // A Mentor sees the same list, in the same order, opening in a new tab.
    const mentorContext = await browser.newContext();
    const mentor = await mentorContext.newPage();
    await signInAs(mentor, BLENDED_MENTOR_A);
    await mentor.goto("/blended-learning/resources");
    const links = mentor.getByRole("list", { name: "Resources" }).getByRole("link");
    await expect(links).toHaveText([TOOLKIT, renamed, stress.title]);
    await expect(links.nth(1)).toHaveAttribute("href", planner.url);
    await expect(links.nth(1)).toHaveAttribute("target", "_blank");

    for (const title of [renamed, stress.title]) {
      await page.getByRole("button", { name: `Remove ${title}` }).click();
      const dialog = page.getByRole("dialog", { name: "Remove this resource?" });
      await expect(dialog).toContainText(title);
      await dialog.getByRole("button", { name: "Remove" }).click();
      await expect(dialog).toHaveCount(0);
    }
    await expect(resourceList(page)).toHaveCount(1);
    expect(await resourceTitles()).toEqual([TOOLKIT]);

    await mentor.reload();
    await expect(links).toHaveText([TOOLKIT]);
    await mentorContext.close();
  });

  test("the Manage page fits a 360 px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signInAs(page, BLENDED_ADMIN);
    await openManage(page);
    await page.getByRole("radio", { name: "One mentor's students" }).check();
    await page.getByLabel("Mentor", { exact: true }).selectOption({ label: `${BLENDED_MENTOR_D.name} (2 students)` });
    await expect(page.getByText("Will be added to 2 students.")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    for (const control of [
      page.getByRole("button", { name: `Edit ${TOOLKIT}` }),
      page.getByRole("button", { name: "Add resource" }),
      page.getByRole("button", { name: "Push to students" }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Blended Learning Manage — Common Action Items", () => {
  const text = "Synthetic: submit the scholarship form";
  const edited = "Synthetic: submit the scholarship form by Friday";
  const { first, second, mappedLater } = MANAGE_MENTEES;

  test("an admin pushes one to a Mentor's students; the Mentor ticks it off; edit, push again and remove", async ({ page, browser }) => {
    await signInAs(page, BLENDED_ADMIN);
    await openManage(page);

    // Preview counts for every kind of target.
    const preview = async (target: Record<string, unknown>) =>
      (await (await page.request.post("/api/blended-learning/common-action-items/preview", { data: target })).json()).count;
    const active = await withPool(async (pool) => {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM blended_learning_mentor_mentee_mappings WHERE academic_year = $1 AND ended_at IS NULL`,
        [CURRENT_ACADEMIC_YEAR]
      );
      return Number(result.rows[0].count);
    });
    expect(await preview({ kind: "all" })).toBe(active);
    expect((await preview({ kind: "grade", grade: 12 })) + (await preview({ kind: "grade", grade: 13 }))).toBe(active);
    expect(await preview({ kind: "mentor", mentorUserId: mentorDUserId })).toBe(2);

    const form = page.getByRole("form", { name: "New program action item" });
    await form.getByLabel("Action item").fill(text);
    await form.getByLabel("Who does it").selectOption({ label: "Student" });
    await form.getByRole("radio", { name: "One mentor's students" }).check();
    await expect(form.getByText("Choose a mentor to see how many students get it.")).toBeVisible();
    await form.getByLabel("Mentor", { exact: true }).selectOption({ label: `${BLENDED_MENTOR_D.name} (2 students)` });
    await expect(form.getByText("Will be added to 2 students.")).toBeVisible();
    await form.getByRole("button", { name: "Push to students" }).click();
    const confirm = page.getByRole("dialog", { name: "Push this action item?" });
    await expect(confirm).toContainText(`${BLENDED_MENTOR_D.name}'s students · Will be added to 2 students.`);
    await confirm.getByRole("button", { name: "Push" }).click();
    await expect(confirm).toHaveCount(0);

    const item = commonItem(page, text);
    await expect(item).toContainText(`${BLENDED_MENTOR_D.name}'s students`);
    await expect(item.locator("dt:text-is('Open') + dd")).toHaveText("2");
    await expect(item.locator("dt:text-is('Done') + dd")).toHaveText("0");
    expect(await pushedRows()).toEqual([
      expect.objectContaining({ student_id: studentIds[first.key], conversation_id: null, text, owner: "student", status: "open" }),
      expect.objectContaining({ student_id: studentIds[second.key], conversation_id: null, text, owner: "student", status: "open" }),
    ]);

    // Mentor D sees it tagged "From program" and ticks it off while logging.
    const mentorContext = await browser.newContext();
    const mentor = await mentorContext.newPage();
    await signInAs(mentor, BLENDED_MENTOR_D);
    await mentor.goto(`/blended-learning/students/${studentIds[first.key]}`);
    const open = mentor.getByRole("region", { name: "Open Action Items" }).getByRole("listitem").filter({ hasText: text });
    await expect(open).toContainText("From program");
    await mentor.goto(`/blended-learning/students/${studentIds[first.key]}/log`);
    const logForm = mentor.getByRole("form", { name: "Log a Conversation or Attempt" });
    await logForm.getByRole("radio", { name: "Call" }).check();
    await logForm.getByRole("radio", { name: "Student", exact: true }).check();
    await logForm.getByLabel("Duration (minutes)").fill("20");
    await logForm.getByLabel("Summary").fill("Synthetic: checked the scholarship form.");
    const panel = mentor.getByRole("region", { name: "Open Action Items" });
    await expect(panel.getByRole("listitem").filter({ hasText: text })).toContainText("From program");
    await panel.getByRole("checkbox", { name: new RegExp(text) }).check();
    await logForm.getByRole("button", { name: "Save conversation" }).click();
    await expect(mentor.getByRole("region", { name: "Saved" }).getByRole("heading", { name: "Conversation saved" })).toBeVisible();

    const savedConversation = await withPool(async (pool) => {
      const result = await pool.query<{ id: number }>(
        `SELECT max(id)::int AS id FROM blended_learning_conversations WHERE student_id = $1`,
        [studentIds[first.key]]
      );
      return result.rows[0].id;
    });
    expect((await pushedRows()).find((row) => row.student_id === studentIds[first.key])).toMatchObject({
      status: "done",
      completed_by_conversation_id: savedConversation,
      completed_by_email: BLENDED_MENTOR_D.email,
    });

    await page.reload();
    await expect(item.locator("dt:text-is('Open') + dd")).toHaveText("1");
    await expect(item.locator("dt:text-is('Done') + dd")).toHaveText("1");

    // Editing changes the still-open row only.
    await item.getByRole("button", { name: `Edit: ${text}` }).click();
    const edit = page.getByRole("form", { name: "Edit program action item" });
    await edit.getByLabel("Action item").fill(edited);
    await edit.getByLabel("Who does it").selectOption({ label: "Parent" });
    await edit.getByRole("button", { name: "Save" }).click();
    // The open input holds the new text too, so wait for the form to close.
    await expect(edit).toHaveCount(0);
    const editedItem = commonItem(page, edited);
    await expect(editedItem.getByRole("button", { name: `Edit: ${edited}` })).toBeVisible();
    expect(await pushedRows()).toEqual([
      expect.objectContaining({ student_id: studentIds[first.key], text, owner: "student", status: "done" }),
      expect.objectContaining({ student_id: studentIds[second.key], text: edited, owner: "parent", status: "open" }),
    ]);

    // A Student mapped later gets it only when it is pushed again; nobody gets it twice.
    await withPool((pool) =>
      pool.query(
        `INSERT INTO blended_learning_mentor_mentee_mappings
           (student_id, mentor_user_id, program_id, academic_year, started_at, assignment_source)
         VALUES ($1, $2, $3, $4, now(), 'e2e_fixture')`,
        [studentIds[mappedLater.key], mentorDUserId, mappedLater.programId, CURRENT_ACADEMIC_YEAR]
      )
    );
    await page.reload();
    await expect(editedItem.locator("dt:text-is('Not yet added') + dd")).toHaveText("1");
    await editedItem.getByRole("button", { name: `Push again: ${edited}` }).click();
    const again = page.getByRole("dialog", { name: "Push this action item again?" });
    await expect(again).toContainText("Will be added to 1 student who don't have it yet.");
    await again.getByRole("button", { name: "Push" }).click();
    await expect(again).toHaveCount(0);
    await expect(editedItem.locator("dt:text-is('Open') + dd")).toHaveText("2");
    await expect(editedItem.getByRole("button", { name: `Push again: ${edited}` })).toBeDisabled();
    expect(await pushedRows()).toHaveLength(3);
    const repeat = await page.request.post(
      `/api/blended-learning/common-action-items/${await commonId(edited)}/push`
    );
    expect(await repeat.json()).toEqual({ added: 0 });

    // Removing deletes the open rows and keeps the done one.
    await editedItem.getByRole("button", { name: `Remove: ${edited}` }).click();
    const remove = page.getByRole("dialog", { name: "Remove this action item?" });
    await expect(remove).toContainText("Deletes it from the 2 students who still have it open. The 1 done stay in their history.");
    await remove.getByRole("button", { name: "Remove" }).click();
    await expect(remove).toHaveCount(0);
    await expect(commonItem(page, edited)).toHaveCount(0);
    expect(await pushedRows()).toEqual([
      expect.objectContaining({ student_id: studentIds[first.key], text, status: "done" }),
    ]);
    const removed = await withPool(async (pool) => {
      const result = await pool.query<{ removed: boolean; removed_by_email: string }>(
        `SELECT removed_at IS NOT NULL AS removed, removed_by_email FROM blended_learning_common_action_items WHERE text = $1`,
        [edited]
      );
      return result.rows;
    });
    expect(removed).toEqual([{ removed: true, removed_by_email: BLENDED_ADMIN.email }]);

    await mentor.goto(`/blended-learning/students/${studentIds[second.key]}`);
    await expect(mentor.getByRole("heading", { name: `${second.firstName} ${second.lastName}` })).toBeVisible();
    await expect(mentor.getByRole("region", { name: "Open Action Items" })).toHaveCount(0);
    await mentorContext.close();
  });
});

test.describe("Blended Learning Manage — specific students", () => {
  const text = "Synthetic: bring the signed hostel form";
  const { second, mappedLater } = MANAGE_MENTEES;
  // Mapped to Mentor A last academic year only: found, but no active mentor.
  const noMentor = "E2E-BL-P1";
  const unknown = "00012345678";

  test("an admin pastes Student IDs, sees which won't get it, and pushes to the mapped ones", async ({ page, browser }) => {
    await signInAs(page, BLENDED_ADMIN);
    await openManage(page);
    const form = page.getByRole("form", { name: "New program action item" });
    await form.getByLabel("Action item").fill(text);
    await form.getByRole("radio", { name: "Specific students" }).check();
    await expect(form.getByText("Paste Student IDs to see how many students get it.")).toBeVisible();
    // Mentor D's H2 and H3 (H3 was mapped by the test above), whitespace, comma and new-line separated.
    await form.getByLabel("Student IDs").fill(`E2E-BL-${second.key},  ${unknown}\n${noMentor} E2E-BL-${mappedLater.key}\nE2E-BL-${second.key}`);
    await expect(form.getByText("Will be added to 2 students.")).toBeVisible();
    await expect(form).toContainText(`1 ID not found: ${unknown}`);
    await expect(form).toContainText(`1 ID found but with no active mentor: ${noMentor}`);

    await form.getByRole("button", { name: "Push to students" }).click();
    const confirm = page.getByRole("dialog", { name: "Push this action item?" });
    await expect(confirm).toContainText("Specific students (4 IDs listed) · Will be added to 2 students.");
    await confirm.getByRole("button", { name: "Push" }).click();
    await expect(confirm).toHaveCount(0);

    const item = commonItem(page, text);
    await expect(item).toContainText("Specific students (4 IDs listed)");
    await expect(item.locator("dt:text-is('Open') + dd")).toHaveText("2");
    await expect(item.getByRole("button", { name: `Push again: ${text}` })).toBeDisabled();
    expect((await pushedRows(new RegExp(text))).map((row) => row.student_id)).toEqual([
      studentIds[second.key],
      studentIds[mappedLater.key],
    ]);
    const stored = await withPool(async (pool) => {
      const result = await pool.query<{ target_student_ids: string[] }>(
        `SELECT target_student_ids FROM blended_learning_common_action_items WHERE text = $1`,
        [text]
      );
      return result.rows[0].target_student_ids;
    });
    expect(stored).toEqual([`E2E-BL-${second.key}`, unknown, noMentor, `E2E-BL-${mappedLater.key}`]);

    const mentorContext = await browser.newContext();
    const mentor = await mentorContext.newPage();
    await signInAs(mentor, BLENDED_MENTOR_D);
    await mentor.goto(`/blended-learning/students/${studentIds[mappedLater.key]}`);
    await expect(
      mentor.getByRole("region", { name: "Open Action Items" }).getByRole("listitem").filter({ hasText: text })
    ).toContainText("From program");
    await mentorContext.close();

    // Clean up for later specs.
    await item.getByRole("button", { name: `Remove: ${text}` }).click();
    await page.getByRole("dialog", { name: "Remove this action item?" }).getByRole("button", { name: "Remove" }).click();
    await expect(commonItem(page, text)).toHaveCount(0);
    expect(await pushedRows(new RegExp(text))).toEqual([]);
  });
});

async function commonId(text: string): Promise<number> {
  return withPool(async (pool) => {
    const result = await pool.query<{ id: number }>(
      `SELECT id::int AS id FROM blended_learning_common_action_items WHERE text = $1`,
      [text]
    );
    return result.rows[0].id;
  });
}
