import { test, expect, signInAs } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";
import {
  BLENDED_MENTOR_A,
  BLENDED_MENTOR_B,
  BLENDED_MENTOR_C,
  BLENDED_SUPERVISOR,
  FEED_FLAGS,
  MENTEES,
  OTHER_STUDENTS,
  SUPERVISOR_MENTEE,
  fullName,
} from "../helpers/blended-learning-fixtures";

// A team-lead Mentor (BLENDED_SUPERVISOR) against the real fixture DDL: they
// land on Team cards for themselves and Mentor B, log for their own Mentee
// (Lata) under My Students, view Mentor B's Mentees (Sana, Tara) and flags
// read-only through a running Supervision (never a dropout of theirs), and
// see nothing of Mentor A's, whose Supervision has ended. Writes are refused
// server-side.

const { mentorB: tara, reassignedToB: sana } = OTHER_STUDENTS;
const { attemptLatest: ira } = MENTEES;

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

function teamCards(page: Page) {
  return page.getByRole("list", { name: "Mentors" }).getByRole("link");
}

test.describe("Blended Learning supervisor view", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, BLENDED_SUPERVISOR);
  });

  test("a team lead lands on Team: their own card first, then their reportee's, with the admin cards' stats", async ({ page }) => {
    await page.goto("/blended-learning");

    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeAttached();
    // The Flags badge counts the supervised Mentor's Students' new flags too (Tara's two).
    const tabs = page.getByRole("navigation", { name: "Mentor views" });
    await expect(tabs.getByRole("link")).toHaveText(["Team", "My Students", "JEE Form", "Flags2 new", "Resources"]);
    await expect(tabs.getByRole("link", { name: "Team" })).toHaveAttribute("aria-current", "page");
    // Mentor A's Supervision has ended: no card for them.
    await expect(teamCards(page)).toHaveCount(2);
    await expect(teamCards(page).nth(0)).toContainText(`${BLENDED_SUPERVISOR.name}You`);
    await expect(teamCards(page).nth(0)).toContainText("Assigned1");
    await expect(teamCards(page).nth(1)).toContainText(BLENDED_MENTOR_B.name);
    await expect(teamCards(page).nth(1)).toContainText("Assigned2");
    await expect(page.getByRole("navigation", { name: "Whose students" })).toHaveCount(0);
  });

  test("their own card opens their own list under My Students, theirs to log for", async ({ page }) => {
    await page.goto("/blended-learning");
    await teamCards(page).nth(0).click();

    await expect(page).toHaveURL(/\/blended-learning\?tab=students$/);
    await expect(page.getByRole("heading", { level: 1, name: "My Students" })).toBeAttached();
    await expect(page.getByRole("navigation", { name: "Mentor views" }).getByRole("link", { name: "My Students" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    await expect(page.getByText(/^1 student · \d{4}-\d{4}$/)).toBeVisible();
    await expect(page.getByRole("link", { name: `New log for ${fullName(SUPERVISOR_MENTEE)}` }).first()).toBeVisible();
    await expect(page.getByRole("note")).toHaveCount(0);
    await expect(page.getByText(fullName(tara))).toHaveCount(0);

    // Their own Mentor page is the same list.
    await page.goto(`/blended-learning/mentors/${await mentorId(BLENDED_SUPERVISOR.email)}`);
    await expect(page).toHaveURL(/\/blended-learning\?tab=students$/);
  });

  test("a reportee's card opens that Mentor's list, view only", async ({ page }) => {
    await page.goto("/blended-learning");
    await teamCards(page).filter({ hasText: BLENDED_MENTOR_B.name }).click();

    await expect(page).toHaveURL(new RegExp(`/blended-learning/mentors/${await mentorId(BLENDED_MENTOR_B.email)}$`));
    await expect(page.getByRole("heading", { level: 1, name: BLENDED_MENTOR_B.name })).toBeVisible();
    await expect(page.getByRole("note")).toContainText(`View only. ${BLENDED_MENTOR_B.name} mentors these students`);
    await expect(page.getByText(/^2 students · \d{4}-\d{4}$/)).toBeVisible();
    for (const mentee of [tara, sana]) {
      await expect(page.getByRole("link", { name: `View ${fullName(mentee)}` }).first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /^New log for / })).toHaveCount(0);
    await expect(page.getByText(fullName(SUPERVISOR_MENTEE))).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team" })).toHaveAttribute("href", "/blended-learning");
  });

  test("a supervised Mentor's dropout is hidden from the supervisor too", async ({ page }) => {
    const sanaId = await studentId(sana);
    const before = await withPool(async (pool) => {
      const result = await pool.query<{ status: string | null }>(`SELECT status FROM student WHERE id = $1`, [sanaId]);
      await pool.query(`UPDATE student SET status = 'dropout' WHERE id = $1`, [sanaId]);
      return result.rows[0].status;
    });
    try {
      await page.goto("/blended-learning");
      await expect(teamCards(page).nth(1)).toContainText("Assigned1");

      await page.goto(`/blended-learning/mentors/${await mentorId(BLENDED_MENTOR_B.email)}`);
      await expect(page.getByText(/^1 student · \d{4}-\d{4}$/)).toBeVisible();
      await expect(page.getByRole("link", { name: `View ${fullName(tara)}` }).first()).toBeVisible();
      await expect(page.getByText(fullName(sana))).toHaveCount(0);

      const response = await page.goto(`/blended-learning/students/${sanaId}`);
      expect(response?.status()).toBe(404);
    } finally {
      await withPool((pool) => pool.query(`UPDATE student SET status = $2 WHERE id = $1`, [sanaId, before]));
    }
  });

  test("an ended Supervision or an unsupervised Mentor shows nothing of theirs", async ({ page }) => {
    // Mentor A's Supervision ended; Mentor C was never theirs.
    for (const mentor of [BLENDED_MENTOR_A, BLENDED_MENTOR_C]) {
      const response = await page.goto(`/blended-learning/mentors/${await mentorId(mentor.email)}`);
      expect(response?.status()).toBe(404);
    }
    await expect(page.getByText(fullName(ira))).toHaveCount(0);

    const response = await page.goto(`/blended-learning/students/${await studentId(ira)}`);
    expect(response?.status()).toBe(404);
  });

  test("a supervised Mentor's Mentee's page is view only, and its log page sends them back", async ({ page }) => {
    const taraId = await studentId(tara);
    const mentorBId = await mentorId(BLENDED_MENTOR_B.email);
    await page.goto(`/blended-learning/mentors/${mentorBId}`);
    await page.getByRole("link", { name: `View ${fullName(tara)}` }).first().click();

    await expect(page).toHaveURL(new RegExp(`/blended-learning/students/${taraId}$`));
    await expect(page.getByRole("heading", { level: 1, name: fullName(tara) })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("View only.");
    await expect(page.getByText(FEED_FLAGS.taraMaths.comment)).toBeVisible();
    // No way to log at all: not a link, and not a greyed-out button either.
    await expect(page.getByRole("link", { name: "Log conversation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Log conversation" })).toHaveCount(0);
    // The JEE form is full scope only: no status line and no JEE tab link.
    await expect(page.getByRole("region", { name: "JEE Main 2027 form" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /JEE tab/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Back to .*'s students$/ })).toHaveAttribute(
      "href",
      `/blended-learning/mentors/${mentorBId}`
    );

    await page.goto(`/blended-learning/students/${taraId}/log`);
    await expect(page).toHaveURL(new RegExp(`/blended-learning/students/${taraId}$`));
  });

  test("a supervised Mentor's Mentee's open draft shows its state but no Retry, Discard or Review", async ({ page }) => {
    const taraId = await studentId(tara);
    const draftId = await withPool(async (pool) => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO blended_learning_conversation_drafts
           (student_id, program_id, academic_year, mentor_user_id, created_by_email, state,
            call_recording_s3_key, recording_content_type)
         SELECT mapping.student_id, mapping.program_id, mapping.academic_year, mapping.mentor_user_id, $3, 'failed',
                'lms-documents/blended-learning/recordings/e2e-supervisor-draft.mp3', 'audio/mpeg'
         FROM blended_learning_mentor_mentee_mappings mapping
         WHERE mapping.student_id = $1 AND mapping.academic_year = $2 AND mapping.ended_at IS NULL
         LIMIT 1
         RETURNING id`,
        [taraId, CURRENT_ACADEMIC_YEAR, BLENDED_MENTOR_B.email]
      );
      return Number(result.rows[0].id);
    });
    try {
      await page.goto(`/blended-learning/students/${taraId}`);
      const draft = page.getByRole("region", { name: "Conversation Draft" });
      await expect(draft).toContainText("Drafting failed");
      await expect(draft.getByRole("button")).toHaveCount(0);
      await expect(draft.getByRole("link")).toHaveCount(0);
    } finally {
      await withPool((pool) => pool.query(`DELETE FROM blended_learning_conversation_drafts WHERE id = $1`, [draftId]));
    }
  });

  test("their own Mentee's page goes back to My Students", async ({ page }) => {
    await page.goto(`/blended-learning/students/${await studentId(SUPERVISOR_MENTEE)}`);

    await expect(page.getByRole("note")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Log conversation" }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "JEE Main 2027 form" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to students" })).toHaveAttribute("href", "/blended-learning?tab=students");
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

    // The JEE form is full scope only: no recording, revealing or reading it.
    const jee = await page.request.post(`/api/blended-learning/students/${taraId}/jee-form`, {
      multipart: { status: "not_filled", reasons: "not_aware" },
    });
    expect(jee.status()).toBe(404);
    const reveal = await page.request.post(`/api/blended-learning/students/${taraId}/jee-form/password`);
    expect(reveal.status()).toBe(403);
    const confirmation = await page.request.get(`/api/blended-learning/students/${taraId}/jee-form/confirmation`, {
      maxRedirects: 0,
    });
    expect(confirmation.status()).toBe(404);

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

  test("the Mentor filter goes by whose Student it is now: one moved from the lead to a reportee is the reportee's", async ({ page }) => {
    const lataId = await studentId(SUPERVISOR_MENTEE);
    const [leadId, mentorBId] = [await mentorId(BLENDED_SUPERVISOR.email), await mentorId(BLENDED_MENTOR_B.email)];
    const comment = "Synthetic: flagged by the lead before the move";
    // The lead logged and flagged Lata, then Lata moved to Mentor B. Undone below.
    const added = await withPool(async (pool) => {
      const conversation = await pool.query<{ id: string }>(
        `INSERT INTO blended_learning_conversations
           (student_id, program_id, academic_year, mentor_user_id, logged_by_email, kind, occurred_on,
            mode, spoke_with, duration_minutes, summary)
         VALUES ($1, $2, $3, $4, $5, 'conversation', (now() AT TIME ZONE 'Asia/Kolkata')::date - 5,
                 'call', 'student', 10, 'Synthetic: before the move')
         RETURNING id`,
        [lataId, SUPERVISOR_MENTEE.programId, CURRENT_ACADEMIC_YEAR, leadId, BLENDED_SUPERVISOR.email]
      );
      const conversationId = Number(conversation.rows[0].id);
      await pool.query(
        `INSERT INTO blended_learning_mentor_flags (conversation_id, student_id, recipient, comment, raised_by_email, inserted_at)
         VALUES ($1, $2, 'maths', $3, $4, now() - interval '5 days')`,
        [conversationId, lataId, comment, BLENDED_SUPERVISOR.email]
      );
      const ended = await pool.query<{ id: string }>(
        `UPDATE blended_learning_mentor_mentee_mappings SET ended_at = date_trunc('second', now() AT TIME ZONE 'UTC'), ended_by_email = 'e2e-fixture@example.com', end_source = 'e2e_fixture', end_reason = 'reassigned'
         WHERE student_id = $1 AND mentor_user_id = $2 AND academic_year = $3 AND ended_at IS NULL
         RETURNING id`,
        [lataId, leadId, CURRENT_ACADEMIC_YEAR]
      );
      const moved = await pool.query<{ id: string }>(
        `INSERT INTO blended_learning_mentor_mentee_mappings
           (student_id, mentor_user_id, program_id, academic_year, started_at, assignment_source)
         VALUES ($1, $2, $3, $4, date_trunc('second', now() AT TIME ZONE 'UTC'), 'e2e_fixture')
         RETURNING id`,
        [lataId, mentorBId, SUPERVISOR_MENTEE.programId, CURRENT_ACADEMIC_YEAR]
      );
      return { conversationId, endedMapping: Number(ended.rows[0].id), movedMapping: Number(moved.rows[0].id) };
    });
    try {
      const feed = page.getByRole("region", { name: "Mentor Flags" });
      await page.goto(`/blended-learning?tab=flags&mentor=${leadId}`);
      await expect(feed.getByText("No Mentor Flags match these filters.")).toBeVisible();
      await expect(feed.getByText(comment)).toHaveCount(0);

      await page.goto(`/blended-learning?tab=flags&mentor=${mentorBId}`);
      await expect(feed.getByText(comment)).toBeVisible();
      await expect(feed.getByText(FEED_FLAGS.taraMaths.comment)).toBeVisible();
    } finally {
      await withPool(async (pool) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`DELETE FROM blended_learning_mentor_mentee_mappings WHERE id = $1`, [added.movedMapping]);
          await client.query(
            `UPDATE blended_learning_mentor_mentee_mappings SET ended_at = NULL, ended_by_email = NULL, end_source = NULL, end_reason = NULL WHERE id = $1`,
            [added.endedMapping]
          );
          await client.query(`DELETE FROM blended_learning_mentor_flags WHERE conversation_id = $1`, [added.conversationId]);
          // Conversations are append-only (a trigger); skip it for this test-DB cleanup only.
          await client.query("SET LOCAL session_replication_role = replica");
          await client.query(`DELETE FROM blended_learning_conversations WHERE id = $1`, [added.conversationId]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      });
    }
  });

  test("a supervisor gets no Manage page", async ({ page }) => {
    await page.goto("/blended-learning/manage");
    await expect(page).toHaveURL(/\/blended-learning$/);
  });

  test("the Team cards and a reportee's list fit a 360 px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of ["/blended-learning", `/blended-learning/mentors/${await mentorId(BLENDED_MENTOR_B.email)}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

test("a Mentor who supervises no one lands on My Students, with no Team tab or Mentor pages", async ({ page }) => {
  await signInAs(page, BLENDED_MENTOR_B);
  await page.goto("/blended-learning");

  await expect(page.getByRole("heading", { level: 1, name: "My Students" })).toBeAttached();
  await expect(page.getByRole("navigation", { name: "Mentor views" }).getByRole("link", { name: "Team" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Mentors" })).toHaveCount(0);
  await expect(page.getByText(fullName(SUPERVISOR_MENTEE))).toHaveCount(0);

  await page.goto(`/blended-learning/mentors/${await mentorId(BLENDED_SUPERVISOR.email)}`);
  await expect(page).toHaveURL(/\/blended-learning$/);
});
