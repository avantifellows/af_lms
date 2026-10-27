import { test, expect, signInAs } from "../fixtures/auth";
import type { Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";
import { BLENDED_MENTOR_A, MENTEES, fullName } from "../helpers/blended-learning-fixtures";

// Call Recording upload and drafting state (#449). S3 and etl-next are absent
// in e2e, so the upload itself (presign, PUT, draft creation and the wake
// outcomes) is covered by the route tests; here the upload control shows for
// a Mentor only, and the detail page polls a drafting draft's state. Ira (A1)
// has no open draft; Rohan (A6) has a failed one.
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", viewport: { width: 360, height: 740 } },
] as const;

const studentIds: Record<string, number> = {};

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id = ANY($1)`,
      [[`E2E-BL-${MENTEES.attemptLatest.key}`, `E2E-BL-${MENTEES.recent.key}`]]
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
  } finally {
    await pool.end();
  }
});

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const { label, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Call Recording upload — ${label}`, () => {
    test.use({ viewport });

    test("a Mentor can pick an audio Call Recording on the log page", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentIds[MENTEES.attemptLatest.key]}/log`);

      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      const upload = form.getByRole("region", { name: "Recording" });
      await expect(upload.getByText(/MP3, M4A or WAV, up to 200 MB\./)).toBeVisible();
      await expect(upload.getByLabel("Upload the recording")).toHaveAttribute("accept", "audio/*");
      // The whole dashed drop zone opens the picker.
      const dropZone = upload.locator("label").filter({ hasText: "Upload the recording" });
      await expect(dropZone).toBeVisible();
      expect((await dropZone.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      // Only a Conversation has a recording.
      await form.getByRole("radio", { name: "Attempt" }).check();
      await expect(form.getByRole("region", { name: "Recording" })).toHaveCount(0);
    });

    test("a Mentee with an open Conversation Draft offers no second upload", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentIds[MENTEES.recent.key]}/log`);

      // Rohan's draft failed: the Recording card shows it, with its controls,
      // in place of the upload.
      const recording = page.getByRole("region", { name: "Recording" });
      const draft = recording.getByRole("region", { name: "Conversation Draft" });
      await expect(draft.getByText("Drafting failed")).toBeVisible();
      await expect(draft.getByRole("button", { name: "Discard" })).toBeVisible();
      await expect(page.getByLabel("Upload the recording")).toHaveCount(0);
    });

    test("a read-only admin has no upload control", async ({ page }) => {
      await signInAs(page, BLENDED_ADMIN_READ_ONLY);
      const detail = `/blended-learning/students/${studentIds[MENTEES.attemptLatest.key]}`;
      await page.goto(`${detail}/log`);
      await expect(page).toHaveURL(new RegExp(`${detail}$`));
      await expect(page.getByRole("heading", { name: fullName(MENTEES.attemptLatest) })).toBeVisible();
      await expect(page.getByLabel("Upload the recording")).toHaveCount(0);

      const response = await page.request.post(`/api/blended-learning/students/${studentIds[MENTEES.attemptLatest.key]}/recordings/upload-url`, {
        data: { fileName: "call.mp3", contentType: "audio/mpeg", byteSize: 1000 },
      });
      expect(response.status()).toBe(403);
    });
  });
}

test.describe("Blended Learning drafting state", () => {
  test("the detail page polls a drafting draft every 15 seconds", async ({ page }) => {
    const studentId = studentIds[MENTEES.attemptLatest.key];
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
            call_recording_s3_key, recording_content_type)
         VALUES ($1, $2, $3, $4, $5, 'transcribing', $6, 'audio/mpeg')
         RETURNING id`,
        [
          studentId,
          mapping.rows[0].program_id,
          CURRENT_ACADEMIC_YEAR,
          mapping.rows[0].mentor_user_id,
          BLENDED_MENTOR_A.email,
          `lms-documents/blended-learning/recordings/${studentId}/00000000-0000-4000-8000-000000000449.mp3`,
        ]
      );
      const draftId = inserted.rows[0].id;

      await page.clock.install();
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentId}`);
      const draft = page.getByRole("region", { name: "Conversation Draft" });
      await expect(draft.getByText("Drafting from the Call Recording")).toBeVisible();

      // An open draft blocks a second upload.
      const second = await page.request.post(`/api/blended-learning/students/${studentId}/recordings/upload-url`, {
        data: { fileName: "a.mp3", byteSize: 1 },
      });
      expect(second.status()).toBe(409);

      // etl-next gives up on it; the next poll picks that up without a reload.
      await pool.query(`UPDATE blended_learning_conversation_drafts SET state = 'failed' WHERE id = $1`, [draftId]);
      const polled = page.waitForResponse(`**/api/blended-learning/drafts/${draftId}`);
      await page.clock.runFor(15_000);
      await polled;
      await expect(draft.getByText("Drafting failed")).toBeVisible();
    } finally {
      // Leave Ira with no draft for the other specs.
      await pool.query(`DELETE FROM blended_learning_conversation_drafts WHERE student_id = $1`, [studentId]);
      await pool.end();
    }
  });
});
