import { test, expect, signInAs } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_B,
  BLENDED_SUPERVISOR,
  FEED_FLAGS,
  MENTEES,
  OTHER_STUDENTS,
  SUPERVISOR_MENTEE,
  fullName,
} from "../helpers/blended-learning-fixtures";

// A team-lead Mentor (BLENDED_SUPERVISOR) against the real fixture DDL: they
// log for their own Mentee (Lata), view Mentor B's Mentees (Sana, Tara) and
// flags read-only through a running Supervision, and see nothing of Mentor A's,
// whose Supervision has ended. Writes are refused server-side.

const { mentorB: tara, reassignedToB: sana } = OTHER_STUDENTS;
const { attemptLatest: ira } = MENTEES;
const B_LIST = `${BLENDED_MENTOR_B.name}'s students`;

async function withPool<T>(fn: (pool: ReturnType<typeof getTestPool>) => Promise<T>): Promise<T> {
  const pool = getTestPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function mentorId(email: string): Promise<number> {
  return withPool(async (pool) => {
    const result = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM user_permission WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    return Number(result.rows[0].user_id);
  });
}

async function studentId(mentee: { firstName: string; lastName: string }): Promise<number> {
  return withPool(async (pool) => {
    const result = await pool.query<{ id: string }>(
      `SELECT st.id FROM student st JOIN "user" account ON account.id = st.user_id
       WHERE account.first_name = $1 AND account.last_name = $2`,
      [mentee.firstName, mentee.lastName]
    );
    return Number(result.rows[0].id);
  });
}

async function conversationCount(id: number): Promise<number> {
  return withPool(async (pool) => {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM blended_learning_conversations WHERE student_id = $1`,
      [id]
    );
    return result.rows[0].count;
  });
}

async function firstConversation(id: number): Promise<number> {
  return withPool(async (pool) => {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM blended_learning_conversations WHERE student_id = $1 AND kind = 'conversation' ORDER BY id LIMIT 1`,
      [id]
    );
    return Number(result.rows[0].id);
  });
}

function whose(page: Page) {
  return page.getByRole("navigation", { name: "Whose students" });
}

test.describe("Blended Learning supervisor view", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, BLENDED_SUPERVISOR);
  });

  test("a supervisor's own list is theirs to log for, with a switch to the supervised Mentor's", async ({ page }) => {
    await page.goto("/blended-learning");

    await expect(page.getByRole("heading", { level: 1, name: "My Students" })).toBeAttached();
    await expect(whose(page).getByRole("link", { name: "My students" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/^1 student · \d{4}-\d{4}$/)).toBeVisible();
    await expect(page.getByRole("link", { name: `New log for ${fullName(SUPERVISOR_MENTEE)}` }).first()).toBeVisible();
    await expect(page.getByRole("note")).toHaveCount(0);
    await expect(page.getByText(fullName(tara))).toHaveCount(0);
    // A Mentor's tabs: no Mentors (admin stats) and no Manage. The Flags badge
    // counts the supervised Mentor's Students' new flags too (Tara's two).
    await expect(page.getByRole("navigation", { name: "Mentor views" }).getByRole("link")).toHaveText([
      "My Students",
      "Flags2 new",
      "Resources",
    ]);
  });

  test("the supervised Mentor's list is view only", async ({ page }) => {
    await page.goto("/blended-learning");
    await whose(page).getByRole("link", { name: B_LIST }).click();

    await expect(page).toHaveURL(new RegExp(`/blended-learning\\?mentor=${await mentorId(BLENDED_MENTOR_B.email)}$`));
    await expect(whose(page).getByRole("link", { name: B_LIST })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("note")).toContainText(`View only. ${BLENDED_MENTOR_B.name} mentors these students`);
    await expect(page.getByText(/^2 students · \d{4}-\d{4}$/)).toBeVisible();
    for (const mentee of [tara, sana]) {
      await expect(page.getByRole("link", { name: `View ${fullName(mentee)}` }).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /^New log for / })).toHaveCount(0);
    await expect(page.getByText(fullName(SUPERVISOR_MENTEE))).toHaveCount(0);
  });

  test("an ended Supervision or an unsupervised Mentor shows nothing of theirs", async ({ page }) => {
    await page.goto(`/blended-learning?mentor=${await mentorId(BLENDED_MENTOR_A.email)}`);

    // Falls back to the supervisor's own list.
    await expect(whose(page).getByRole("link", { name: "My students" })).toHaveAttribute("aria-current", "page");
    await expect(whose(page).getByRole("link")).toHaveCount(2);
    await expect(page.getByText(fullName(ira))).toHaveCount(0);

    const response = await page.goto(`/blended-learning/students/${await studentId(ira)}`);
    expect(response?.status()).toBe(404);
  });

  test("a supervised Mentor's Mentee's page is view only, and its log page sends them back", async ({ page }) => {
    const taraId = await studentId(tara);
    await page.goto(`/blended-learning?mentor=${await mentorId(BLENDED_MENTOR_B.email)}`);
    await page.getByRole("link", { name: `View ${fullName(tara)}` }).first().click();

    await expect(page).toHaveURL(new RegExp(`/blended-learning/students/${taraId}$`));
    await expect(page.getByRole("heading", { level: 1, name: fullName(tara) })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("View only.");
    await expect(page.getByText(FEED_FLAGS.taraMaths.comment)).toBeVisible();
    await expect(page.getByRole("link", { name: "Log conversation" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Back to .*'s students$/ })).toHaveAttribute(
      "href",
      `/blended-learning?mentor=${await mentorId(BLENDED_MENTOR_B.email)}`
    );

    await page.goto(`/blended-learning/students/${taraId}/log`);
    await expect(page).toHaveURL(new RegExp(`/blended-learning/students/${taraId}$`));
  });

  test("the server refuses a supervisor's writes for a supervised Mentor's Mentee, and serves the reads", async ({ page }) => {
    const taraId = await studentId(tara);
    const before = await conversationCount(taraId);
    await page.goto("/blended-learning");

    const attempt = await page.request.post(`/api/blended-learning/students/${taraId}/entries`, {
      data: { kind: "attempt", occurredOn: new Date().toISOString().slice(0, 10) },
    });
    expect(attempt.status()).toBe(404);
    const upload = await page.request.post(`/api/blended-learning/students/${taraId}/recordings/upload-url`, {
      data: { fileName: "call.m4a", byteSize: 1024 },
    });
    expect(upload.status()).toBe(404);
    expect(await conversationCount(taraId)).toBe(before);

    const notes = await page.request.get(`/api/blended-learning/conversations/${await firstConversation(taraId)}/notes`);
    expect(notes.status()).toBe(200);
    const irasNotes = await page.request.get(
      `/api/blended-learning/conversations/${await firstConversation(await studentId(ira))}/notes`
    );
    expect(irasNotes.status()).toBe(404);
  });

  test("the Flags tab holds their own and the supervised Mentor's Students' flags, filtered by Mentor", async ({ page }) => {
    await page.goto("/blended-learning?tab=flags");

    const feed = page.getByRole("region", { name: "Mentor Flags" });
    await expect(feed.getByText(FEED_FLAGS.taraMaths.comment)).toBeVisible();
    await expect(feed.getByText(FEED_FLAGS.taraWellbeing.comment)).toBeVisible();
    await expect(feed.getByText(FEED_FLAGS.meeraChemistry.comment)).toHaveCount(0);

    const mentor = page.getByRole("search", { name: "Filter flags" }).getByLabel("Mentor");
    await expect(mentor.getByRole("option")).toHaveText(["All Mentors", "My students", BLENDED_MENTOR_B.name]);
    await mentor.selectOption({ label: "My students" });
    await expect(page).toHaveURL(/mentor=\d+/);
    await expect(feed.getByText("No Mentor Flags match these filters.")).toBeVisible();
  });

  test("a supervisor gets no Manage page and no Mentor pages", async ({ page }) => {
    await page.goto("/blended-learning/manage");
    await expect(page).toHaveURL(/\/blended-learning$/);

    await page.goto(`/blended-learning/mentors/${await mentorId(BLENDED_MENTOR_B.email)}`);
    await expect(page).toHaveURL(/\/blended-learning$/);
  });

  test("the switch fits a 360 px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/blended-learning?mentor=${await mentorId(BLENDED_MENTOR_B.email)}`);

    await expect(page.getByRole("note")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("a Mentor who supervises no one gets no switch", async ({ page }) => {
  await signInAs(page, BLENDED_MENTOR_B);
  await page.goto("/blended-learning");

  await expect(page.getByRole("heading", { level: 1, name: "My Students" })).toBeAttached();
  await expect(page.getByRole("navigation", { name: "Whose students" })).toHaveCount(0);
  await expect(page.getByText(fullName(SUPERVISOR_MENTEE))).toHaveCount(0);
});
