import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { BLENDED_MENTOR_A, IRA_HISTORY, MENTEES } from "../helpers/blended-learning-fixtures";

// Call Recording playback and transcript (#454). Ira's Conversation 20 days
// ago was saved with recording and transcript keys; her Conversation 10 days
// ago was typed by hand. S3 is absent in e2e, so what the routes answer
// (presigned GET, expired, speaker turns) is covered by the route tests; here
// the controls show for admins only, and the browser renders stubbed answers.
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const BLENDED_ADMIN_READ_ONLY = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", viewport: { width: 360, height: 740 } },
] as const;
const { conversation20, conversation10 } = IRA_HISTORY;
const SIGNED_URL = "https://e2e-fake-docs.s3.ap-south-1.amazonaws.com/call.mp3?X-Amz-Expires=300";

let studentId: number;
let recordedConversationId: number;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ id: string }>(`SELECT id FROM student WHERE student_id = $1`, [
      `E2E-BL-${MENTEES.attemptLatest.key}`,
    ]);
    studentId = Number(result.rows[0].id);
    const conversation = await pool.query<{ id: string }>(
      `SELECT id FROM blended_learning_conversations WHERE student_id = $1 AND summary = $2`,
      [studentId, conversation20.summary]
    );
    recordedConversationId = Number(conversation.rows[0].id);
  } finally {
    await pool.end();
  }
});

function entryWith(page: Page, text: string): Locator {
  return page.getByRole("region", { name: "History" }).getByRole("article").filter({ hasText: text });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function stubPlayback(page: Page, recording: object, transcript: object) {
  await page.route("**/api/blended-learning/conversations/*/recording", (route) => route.fulfill({ json: recording }));
  await page.route("**/api/blended-learning/conversations/*/transcript", (route) => route.fulfill({ json: transcript }));
  await page.route(/amazonaws\.com\//, (route) => route.fulfill({ status: 404, body: "" }));
}

for (const { label, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Call Recording playback — ${label}`, () => {
    test.use({ viewport });

    test("an admin plays a saved recording and reads its transcript as speaker turns", async ({ page }) => {
      await stubPlayback(page, { expired: false, url: SIGNED_URL }, {
        expired: false,
        turns: [
          { speaker: "Speaker 1", text: "Namaste beta." },
          { speaker: "Speaker 2", text: "Namaste sir." },
        ],
      });
      await signInAs(page, BLENDED_ADMIN);
      await page.goto(`/blended-learning/students/${studentId}`);

      const entry = entryWith(page, conversation20.summary);
      const play = entry.getByRole("button", { name: "Play recording" });
      await expect(play).toBeVisible();
      expect((await play.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await play.click();
      await expect(entry.locator("audio")).toHaveAttribute("src", SIGNED_URL);

      await entry.getByRole("button", { name: "Show transcript" }).click();
      const turns = entry.getByRole("list", { name: "Transcript" }).getByRole("listitem");
      await expect(turns).toHaveText(["Speaker 1Namaste beta.", "Speaker 2Namaste sir."]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      // A Conversation typed by hand has nothing to play.
      const typed = entryWith(page, conversation10.summary);
      await expect(typed.getByRole("button", { name: "Play recording" })).toHaveCount(0);
      await expect(typed.getByRole("button", { name: "Show transcript" })).toHaveCount(0);
    });

    test("a read-only admin sees 'Recording expired' once S3 has removed the recording", async ({ page }) => {
      await stubPlayback(page, { expired: true }, { expired: true });
      await signInAs(page, BLENDED_ADMIN_READ_ONLY);
      await page.goto(`/blended-learning/students/${studentId}`);

      const entry = entryWith(page, conversation20.summary);
      await entry.getByRole("button", { name: "Play recording" }).click();
      await expect(entry.getByText("Recording expired")).toBeVisible();
      await expect(entry.locator("audio")).toHaveCount(0);

      await entry.getByRole("button", { name: "Show transcript" }).click();
      await expect(entry.getByText("Transcript expired")).toBeVisible();
    });

    test("a Mentor never sees playback or transcript controls, even for their own Mentee", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentId}`);

      const entry = entryWith(page, conversation20.summary);
      await expect(entry.getByRole("button", { name: "Show notes" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Play recording" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Show transcript" })).toHaveCount(0);
    });
  });
}

test("a Mentor gets 403 from the recording and transcript routes", async ({ page }) => {
  await signInAs(page, BLENDED_MENTOR_A);
  for (const path of ["recording", "transcript"]) {
    const response = await page.request.get(`/api/blended-learning/conversations/${recordedConversationId}/${path}`);
    expect(response.status()).toBe(403);
  }
});
