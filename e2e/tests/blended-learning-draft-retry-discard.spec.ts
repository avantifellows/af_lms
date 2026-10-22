import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { CURRENT_ACADEMIC_YEAR } from "../../src/lib/constants";
import { BLENDED_MENTOR_A, MENTEES, fullName } from "../helpers/blended-learning-fixtures";

// Retry or discard a stuck or failed Conversation Draft (#450). etl-next is
// absent in e2e, so the wake is skipped and a retried request stays queued;
// the wake outcomes and the same-key re-wake are covered by the route tests.
// Each test gives Ira (A1, no draft) a draft and removes it afterwards; Rohan
// (A6) keeps the fixture's failed draft for the read-only checks.
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 }, entryRole: "row" },
  { label: "mobile 360", viewport: { width: 360, height: 740 }, entryRole: "listitem" },
] as const;

const { attemptLatest: ira, recent: rohan } = MENTEES;
const studentIds: Record<string, number> = {};

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const students = await pool.query<{ student_id: string; id: string }>(
      `SELECT student_id, id FROM student WHERE student_id = ANY($1)`,
      [[`E2E-BL-${ira.key}`, `E2E-BL-${rohan.key}`]]
    );
    for (const row of students.rows) studentIds[row.student_id.replace("E2E-BL-", "")] = Number(row.id);
  } finally {
    await pool.end();
  }
});

// Give Ira an open draft, as etl-next would have left it.
async function giveIraADraft(state: "ready" | "failed"): Promise<number> {
  const studentId = studentIds[ira.key];
  const pool = getTestPool();
  try {
    const mapping = await pool.query<{ mentor_user_id: string; program_id: string }>(
      `SELECT mentor_user_id, program_id FROM blended_learning_mentor_mentee_mappings
       WHERE student_id = $1 AND academic_year = $2 AND ended_at IS NULL`,
      [studentId, CURRENT_ACADEMIC_YEAR]
    );
    const ready = state === "ready";
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO blended_learning_conversation_drafts
         (student_id, program_id, academic_year, mentor_user_id, created_by_email, state,
          call_recording_s3_key, recording_content_type, recording_byte_size,
          transcript_s3_key, draft_summary, prompt_version, model_id, ready_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'audio/mpeg', 2048, $8, $9, $10, $11,
         CASE WHEN $12 THEN now() ELSE NULL END)
       RETURNING id`,
      [
        studentId,
        mapping.rows[0].program_id,
        CURRENT_ACADEMIC_YEAR,
        mapping.rows[0].mentor_user_id,
        BLENDED_MENTOR_A.email,
        state,
        `lms-documents/blended-learning/recordings/${studentId}/00000000-0000-4000-8000-000000000450.mp3`,
        ready ? `lms-documents/blended-learning/transcripts/${studentId}/e2e-450.json` : null,
        ready ? "Synthetic drafted summary." : null,
        ready ? "fixture-v1" : null,
        ready ? "fixture-model" : null,
        ready,
      ]
    );
    return Number(inserted.rows[0].id);
  } finally {
    await pool.end();
  }
}

// Leave Ira with no draft for the other specs.
async function clearIrasDrafts() {
  const pool = getTestPool();
  try {
    await pool.query(`DELETE FROM blended_learning_transcription_requests WHERE student_id = $1`, [studentIds[ira.key]]);
    await pool.query(`DELETE FROM blended_learning_conversation_drafts WHERE student_id = $1`, [studentIds[ira.key]]);
  } finally {
    await pool.end();
  }
}

async function draftRow(draftId: number) {
  const pool = getTestPool();
  try {
    const draft = await pool.query<{ state: string; discarded: boolean }>(
      `SELECT state, discarded_at IS NOT NULL AS discarded FROM blended_learning_conversation_drafts WHERE id = $1`,
      [draftId]
    );
    const requests = await pool.query<{ request_key: string; state: string }>(
      `SELECT request_key, state FROM blended_learning_transcription_requests WHERE draft_id = $1 ORDER BY id`,
      [draftId]
    );
    return { ...draft.rows[0], requests: requests.rows };
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

function draftPanel(page: Page): Locator {
  return page.getByRole("region", { name: "Conversation Draft" });
}

for (const { label, viewport, entryRole } of VIEWPORTS) {
  test.describe(`Blended Learning draft retry and discard — ${label}`, () => {
    test.use({ viewport });
    test.afterEach(clearIrasDrafts);

    function listEntry(page: Page, mentee: { firstName: string; lastName: string }): Locator {
      return page.getByRole(entryRole).filter({ hasText: fullName(mentee) });
    }

    test("a failed draft offers Retry and Discard; Retry queues a new request and drafting resumes", async ({ page }) => {
      const draftId = await giveIraADraft("failed");
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentIds[ira.key]}`);

      const panel = draftPanel(page);
      await expect(panel.getByText("Drafting failed")).toBeVisible();
      await expectTapTarget(panel.getByRole("button", { name: "Retry", exact: true }));
      await expectTapTarget(panel.getByRole("button", { name: "Discard" }));
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      await panel.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(panel.getByText("Drafting from the Call Recording")).toBeVisible();
      // ETL is unconfigured here, so the new request waits, queued with no run.
      await expect(panel.getByRole("button", { name: "Retry drafting" })).toBeVisible();
      const retried = await draftRow(draftId);
      expect(retried.state).toBe("transcribing");
      expect(retried.requests.map((request) => request.state)).toEqual(["queued"]);

      // Retrying a wake that never arrived reuses that request.
      await panel.getByRole("button", { name: "Retry drafting" }).click();
      await expect(panel.getByText("Asked to draft it again.")).toBeVisible();
      expect((await draftRow(draftId)).requests).toEqual(retried.requests);

      // The page loads the offer too, not only the polls.
      await page.reload();
      await expect(draftPanel(page).getByRole("button", { name: "Retry drafting" })).toBeVisible();
    });

    test("discarding a failed draft removes the draft panel", async ({ page }) => {
      const draftId = await giveIraADraft("failed");
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentIds[ira.key]}`);

      page.once("dialog", (dialog) => dialog.accept());
      await draftPanel(page).getByRole("button", { name: "Discard" }).click();
      await expect(draftPanel(page)).toHaveCount(0);
      expect(await draftRow(draftId)).toMatchObject({ state: "discarded", discarded: true });

      await page.reload();
      await expect(page.getByRole("heading", { name: fullName(ira) })).toBeVisible();
      await expect(draftPanel(page)).toHaveCount(0);
    });

    test("discarding a ready draft removes its list chip and frees the Mentee for a new upload", async ({ page }) => {
      const draftId = await giveIraADraft("ready");
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto("/blended-learning");
      await expect(listEntry(page, ira).getByText("Draft ready to review")).toBeVisible();

      await page.goto(`/blended-learning/students/${studentIds[ira.key]}`);
      const panel = draftPanel(page);
      await expect(panel.getByText("Draft ready to review")).toBeVisible();
      // A ready draft is reviewed, not retried.
      await expect(panel.getByRole("button", { name: /Retry/ })).toHaveCount(0);
      page.once("dialog", (dialog) => dialog.accept());
      await panel.getByRole("button", { name: "Discard" }).click();
      await expect(draftPanel(page)).toHaveCount(0);
      expect(await draftRow(draftId)).toMatchObject({ state: "discarded", discarded: true });

      await page.goto("/blended-learning");
      await expect(listEntry(page, ira)).toBeVisible();
      await expect(listEntry(page, ira).getByText("Draft ready to review")).toHaveCount(0);

      await page.goto(`/blended-learning/students/${studentIds[ira.key]}/log`);
      await expect(page.getByLabel("Upload a Call Recording")).toHaveCount(1);
    });

    test("a read-only admin sees no retry or discard controls, and direct POSTs are refused", async ({ page }) => {
      const pool = getTestPool();
      let draftId: number;
      try {
        const draft = await pool.query<{ id: string }>(
          `SELECT id FROM blended_learning_conversation_drafts WHERE student_id = $1 AND state = 'failed'`,
          [studentIds[rohan.key]]
        );
        draftId = Number(draft.rows[0].id);
      } finally {
        await pool.end();
      }

      await signInAs(page, BLENDED_ADMIN_READ_ONLY);
      await page.goto(`/blended-learning/students/${studentIds[rohan.key]}`);
      const panel = draftPanel(page);
      await expect(panel.getByText("Drafting failed")).toBeVisible();
      await expect(panel.getByRole("button")).toHaveCount(0);

      for (const action of ["retry", "discard"]) {
        const response = await page.request.post(`/api/blended-learning/drafts/${draftId}/${action}`);
        expect(response.status()).toBe(403);
      }
      expect(await draftRow(draftId)).toMatchObject({ state: "failed", discarded: false, requests: [] });
    });
  });
}
