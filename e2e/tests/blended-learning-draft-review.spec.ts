import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";
import { BLENDED_MENTOR_C, DRAFT_REVIEW_MENTEES, fullName } from "../helpers/blended-learning-fixtures";

// Review a ready Conversation Draft and save it as a Conversation (#451).
// etl-next is absent in e2e, so each test inserts the ready draft it would
// have written for a never-contacted Mentee of Mentor C, then reviews and
// saves it. The draft lock and state 409s are covered by the route tests.
const VIEWPORTS = [
  { label: "desktop", key: "desktop", viewport: { width: 1280, height: 800 }, entryRole: "row" },
  { label: "mobile 360", key: "mobile", viewport: { width: 360, height: 740 }, entryRole: "listitem" },
] as const;

// What etl-next drafted from the Call Recording, plus the session details the
// Mentor entered before uploading (a 40-minute in-person talk with the
// Student, the IST day before the run).
const DRAFT = {
  summary: "Synthetic: talked through the mock test result and the revision plan.",
  summaryTags: ["Exam stress", "Physics doubts"],
  actionItems: [
    { text: "Synthetic: redo the optics DPP", owner: "student", dueInDays: 7 },
    { text: "Synthetic: call the parent about coaching", owner: "mentor", dueInDays: null },
  ],
  notes: [{ heading: "Mock test", points: ["Scored <60> in physics & maths", "Wants a <script> study timetable"] }],
  itemsToVerify: ["Is the coaching centre Aakash or Allen?", "Rank 1,240 in the mock test"],
};
// The summary the form opens with: the drafted summary alone; its Summary
// Tags are not used.
const PREFILLED_SUMMARY = DRAFT.summary;
// The drafted notes as the editor saves them, with the drafted text escaped.
const SAVED_NOTES_HTML =
  "<h3>Mock test</h3><ul><li><p>Scored &lt;60&gt; in physics &amp; maths</p></li>" +
  "<li><p>Wants a &lt;script&gt; study timetable</p></li></ul>";

const studentIds: Record<string, number> = {};
let yesterdayIST: string;
let inAWeekIST: string;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id = ANY($1)`,
      [Object.values(DRAFT_REVIEW_MENTEES).map((mentee) => `E2E-BL-${mentee.key}`)]
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
    const dates = await pool.query<{ yesterday: string; in_a_week: string }>(
      `SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text AS yesterday,
              ((now() AT TIME ZONE 'Asia/Kolkata')::date + 7)::text AS in_a_week`
    );
    yesterdayIST = dates.rows[0].yesterday;
    inAWeekIST = dates.rows[0].in_a_week;
  } finally {
    await pool.end();
  }
});

function recordingKey(studentId: number) {
  return `lms-documents/blended-learning/recordings/${studentId}/00000000-0000-4000-8000-000000000451.m4a`;
}

function transcriptKey(studentId: number) {
  return `lms-documents/blended-learning/transcripts/${studentId}/e2e-451.json`;
}

// The ready draft etl-next would have written back.
async function giveAReadyDraft(studentId: number): Promise<number> {
  const pool = getTestPool();
  try {
    const mapping = await pool.query<{ mentor_user_id: string; program_id: string }>(
      `SELECT mentor_user_id, program_id FROM blended_learning_mentor_mentee_mappings
       WHERE student_id = $1 AND academic_year = $2 AND ended_at IS NULL`,
      [studentId, CURRENT_ACADEMIC_YEAR]
    );
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO blended_learning_conversation_drafts
         (student_id, program_id, academic_year, mentor_user_id, created_by_email, state,
          occurred_on, mode, spoke_with, duration_minutes,
          call_recording_s3_key, recording_content_type, recording_byte_size, transcript_s3_key,
          draft_summary, draft_summary_tags, draft_action_items, draft_notes, draft_items_to_verify,
          prompt_version, model_id, ready_at)
       VALUES ($1, $2, $3, $4, $5, 'ready', $6, 'in_person', 'student', 40,
         $7, 'audio/mp4', 4096, $8, $9, $10, $11, $12, $13, 'fixture-v1', 'fixture-model', now())
       RETURNING id`,
      [
        studentId,
        mapping.rows[0].program_id,
        CURRENT_ACADEMIC_YEAR,
        mapping.rows[0].mentor_user_id,
        BLENDED_MENTOR_C.email,
        yesterdayIST,
        recordingKey(studentId),
        transcriptKey(studentId),
        DRAFT.summary,
        DRAFT.summaryTags,
        JSON.stringify(
          DRAFT.actionItems.map((item) => ({
            text: item.text,
            owner: item.owner,
            due_on: item.dueInDays === null ? null : inAWeekIST,
          }))
        ),
        JSON.stringify(DRAFT.notes),
        JSON.stringify(DRAFT.itemsToVerify),
      ]
    );
    return Number(inserted.rows[0].id);
  } finally {
    await pool.end();
  }
}

async function savedRows(studentId: number, draftId: number) {
  const pool = getTestPool();
  try {
    const conversations = await pool.query(
      `SELECT id, kind, occurred_on::text AS occurred_on, mode, spoke_with, duration_minutes, summary,
              notes_html, call_recording_s3_key, transcript_s3_key, source_draft_id::int AS source_draft_id
       FROM blended_learning_conversations WHERE student_id = $1 ORDER BY id`,
      [studentId]
    );
    const actionItems = await pool.query(
      `SELECT position, owner, text, due_on::text AS due_on FROM blended_learning_action_items
       WHERE student_id = $1 ORDER BY position`,
      [studentId]
    );
    const draft = await pool.query<{ state: string; saved_conversation_id: string | null }>(
      `SELECT state, saved_conversation_id FROM blended_learning_conversation_drafts WHERE id = $1`,
      [draftId]
    );
    return { conversations: conversations.rows, actionItems: actionItems.rows, draft: draft.rows[0] };
  } finally {
    await pool.end();
  }
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function expectTapTarget(control: Locator) {
  await expect(control).toBeVisible();
  expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
}

for (const { label, key, viewport, entryRole } of VIEWPORTS) {
  test.describe(`Blended Learning draft review — ${label}`, () => {
    test.use({ viewport });
    const mentee = DRAFT_REVIEW_MENTEES[key];

    function listEntry(page: Page, group: "Talk to first" | "Everyone else") {
      // One table's named rowgroups from 1024 px up; regions of cards below.
      const section = page.getByRole(entryRole === "row" ? "rowgroup" : "region", { name: group, exact: true });
      return section.getByRole(entryRole).filter({ hasText: fullName(mentee) });
    }

    test("a Mentor reviews a ready draft and saves it as a Conversation", async ({ page }) => {
      const studentId = studentIds[mentee.key];
      const draftId = await giveAReadyDraft(studentId);
      await signInAs(page, BLENDED_MENTOR_C);

      // Before saving, the draft is not contact: still never reached.
      await page.goto("/blended-learning");
      const before = listEntry(page, "Talk to first");
      await expect(before).toContainText("Never");
      await expect(before).toContainText("No conversation yet");

      // The detail page offers the review too.
      await page.goto(`/blended-learning/students/${studentId}`);
      const draftPanel = page.getByRole("region", { name: "Conversation Draft" });
      await expect(draftPanel.getByText("Draft ready to review")).toBeVisible();
      await expect(draftPanel.getByRole("link", { name: "Review draft" })).toHaveAttribute(
        "href",
        `/blended-learning/students/${studentId}/log`
      );

      // Open it from the list's chip.
      await page.goto("/blended-learning");
      const chip = listEntry(page, "Talk to first").getByRole("link", { name: "Draft ready to review" });
      await expectTapTarget(chip);
      await chip.click();
      await expect(page).toHaveURL(new RegExp(`/blended-learning/students/${studentId}/log$`));
      await expect(page.getByRole("heading", { name: `Review the draft for ${fullName(mentee)}` })).toBeVisible();

      // The drafted Items to Verify are not shown.
      await expect(page.getByRole("region", { name: "Items to Verify" })).toHaveCount(0);
      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });

      // The form is prefilled from the draft.
      await expect(form.getByLabel("Date")).toHaveValue(yesterdayIST);
      await expect(form.getByRole("radio", { name: "In person" })).toBeChecked();
      await expect(form.getByRole("radio", { name: "Student", exact: true })).toBeChecked();
      await expect(form.getByLabel("Duration (minutes)")).toHaveValue("40");
      await expect(form.getByLabel("Summary")).toHaveValue(PREFILLED_SUMMARY);
      // The Summary Tags are neither in the summary nor shown.
      await expect(form.getByLabel("Summary")).not.toHaveValue(/Tags:/);
      for (const tag of DRAFT.summaryTags) await expect(page.getByText(tag)).toHaveCount(0);
      // The drafted rows only, with no blank starter rows.
      const items = form.getByRole("group", { name: "Action items" });
      await expect(items.getByLabel("Who does action item 1", { exact: true })).toHaveValue("student");
      await expect(items.getByLabel("Action item 1", { exact: true })).toHaveValue(DRAFT.actionItems[0].text);
      // A drafted due date is not shown, and Action Items take none.
      await expect(items.getByLabel(/Due/)).toHaveCount(0);
      await expect(items.getByLabel("Who does action item 2", { exact: true })).toHaveValue("mentor");
      await expect(items.getByLabel("Action item 2", { exact: true })).toHaveValue(DRAFT.actionItems[1].text);
      await expect(items.getByLabel("Action item 3", { exact: true })).toHaveCount(0);
      // Summary and Action items are marked as drafted, the notes as written, from the recording.
      await expect(form.getByText("Drafted from the recording")).toHaveCount(2);
      await expect(form.getByText("Written from the recording")).toBeVisible();
      const notes = form.getByRole("textbox", { name: "Notes" });
      await expect(notes.getByRole("heading", { name: "Mock test" })).toBeVisible();
      // Drafted text is shown as text, never as markup.
      await expect(notes.getByText("Scored <60> in physics & maths")).toBeVisible();
      await expect(notes.getByText("Wants a <script> study timetable")).toBeVisible();
      // The draft already has a recording, so there is no second upload.
      const recording = form.getByRole("region", { name: "Recording" });
      await expect(recording.getByText("Drafted. Check and edit below")).toBeVisible();
      await expect(form.getByLabel("Upload the recording")).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await form.getByRole("button", { name: "Save conversation" }).click();

      const saved = page.getByRole("region", { name: "Saved" });
      await expect(saved.getByRole("heading", { name: "Conversation saved" })).toBeVisible();
      await expect(
        saved.getByText(`${mentee.firstName} moved from "Talk to first" to "Everyone else" in your student list.`)
      ).toBeVisible();

      const rows = await savedRows(studentId, draftId);
      expect(rows.conversations).toEqual([
        {
          id: expect.any(String),
          kind: "conversation",
          occurred_on: yesterdayIST,
          mode: "in_person",
          spoke_with: "student",
          duration_minutes: 40,
          summary: PREFILLED_SUMMARY,
          notes_html: SAVED_NOTES_HTML,
          call_recording_s3_key: recordingKey(studentId),
          transcript_s3_key: transcriptKey(studentId),
          source_draft_id: draftId,
        },
      ]);
      expect(rows.actionItems).toEqual([
        { position: 1, owner: "student", text: DRAFT.actionItems[0].text, due_on: null },
        { position: 2, owner: "mentor", text: DRAFT.actionItems[1].text, due_on: null },
      ]);
      expect(rows.draft).toEqual({ state: "saved", saved_conversation_id: rows.conversations[0].id });

      // Last Contact is now yesterday's Conversation, and the chip is gone.
      await page.goto("/blended-learning");
      const after = listEntry(page, "Everyone else");
      await expect(after).toContainText("Yesterday");
      await expect(after.getByText("Draft ready to review")).toHaveCount(0);
      await expect(listEntry(page, "Talk to first")).toHaveCount(0);
    });
  });
}
