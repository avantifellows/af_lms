import { test, expect, signInAs } from "../fixtures/auth";
import type { Locator, Page } from "@playwright/test";
import { getTestPool } from "../helpers/db";
import { BLENDED_MENTOR_A, MENTEES } from "../helpers/blended-learning-fixtures";

// The Conversation photo picker (#448). S3 is absent in e2e, so the upload
// route is answered here and the save is checked at the request; saved photos
// in the detail history are covered by inserted rows in the detail spec. The
// spec never saves, so Mentor A's Mentees are left as they were.
const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", viewport: { width: 360, height: 740 } },
] as const;

// A 2×2 PNG for the browser to downscale.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "base64"
);
function pngFile(n: number) {
  return { name: `meeting-${n}.png`, mimeType: "image/png", buffer: PNG };
}

let studentId: number;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ id: string }>(`SELECT id FROM student WHERE student_id = $1`, [
      `E2E-BL-${MENTEES.recent.key}`,
    ]);
    studentId = Number(result.rows[0].id);
  } finally {
    await pool.end();
  }
});

// Answer each photo upload with the next key, and record what was sent.
async function stubPhotoUploads(page: Page) {
  const uploads: { contentType: string; body: string }[] = [];
  await page.route(`**/api/blended-learning/students/${studentId}/photos`, async (route) => {
    const request = route.request();
    uploads.push({ contentType: request.headers()["content-type"] ?? "", body: request.postDataBuffer()?.toString("latin1") ?? "" });
    const s3Key = `lms-documents/blended-learning/photos/${studentId}/00000000-0000-4000-8000-00000000000${uploads.length}.jpg`;
    await route.fulfill({ status: 201, json: { s3Key, contentType: "image/jpeg", byteSize: 1234 } });
  });
  return uploads;
}

async function minHeight(locator: Locator): Promise<number> {
  const heights = await locator.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
  return Math.min(...heights);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const { label, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning Conversation photos — ${label}`, () => {
    test.use({ viewport });

    test("a Mentor attaches up to five photos and the Conversation sends their keys", async ({ page }) => {
      const uploads = await stubPhotoUploads(page);
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentId}/log`);

      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      const picker = form.getByRole("group", { name: "Photos (optional)" });
      await expect(picker.getByText("0 of 5 photos")).toBeVisible();
      const addPhoto = picker.getByText("Add photo");
      await expect(addPhoto).toBeVisible();
      expect(await minHeight(addPhoto)).toBeGreaterThanOrEqual(44);

      // Three at once, then three more: only two fit.
      const input = picker.locator('input[type="file"]');
      await input.setInputFiles([pngFile(1), pngFile(2), pngFile(3)]);
      await expect(picker.getByRole("img", { name: /^Photo \d$/ })).toHaveCount(3);
      await input.setInputFiles([pngFile(4), pngFile(5), pngFile(6)]);

      const attached = picker.getByRole("list", { name: "Attached photos" });
      await expect(attached.getByRole("img")).toHaveCount(5);
      await expect(picker.getByText("Uploading…")).toHaveCount(0);
      await expect(picker.getByText("5 of 5 photos")).toBeVisible();
      await expect(picker.getByText("Five photos is the most a Conversation can have.")).toBeVisible();
      await expect(picker.getByText("Add photo")).toHaveCount(0);
      await expect(picker.locator('input[type="file"]')).toHaveCount(0);

      // Each upload is one downscaled JPEG.
      expect(uploads).toHaveLength(5);
      for (const upload of uploads) {
        expect(upload.contentType).toContain("multipart/form-data");
        expect(upload.body).toContain('name="photo"');
        expect(upload.body).toContain("Content-Type: image/jpeg");
      }

      const removeButtons = attached.getByRole("button", { name: /^Remove photo \d$/ });
      await expect(removeButtons).toHaveCount(5);
      expect(await minHeight(removeButtons)).toBeGreaterThanOrEqual(44);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

      // Removing one frees a slot.
      await attached.getByRole("button", { name: "Remove photo 2" }).click();
      await expect(attached.getByRole("img")).toHaveCount(4);
      await expect(picker.getByText("4 of 5 photos")).toBeVisible();
      await expect(picker.getByText("Add photo")).toBeVisible();

      // Saving sends the four remaining keys in order. Answer the save here,
      // since S3 can't confirm the stubbed keys.
      let sent: { photoKeys?: string[] } | null = null;
      await page.route(`**/api/blended-learning/students/${studentId}/entries`, async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({ status: 201, json: { entry: { id: 1, kind: "conversation", occurredOn: "2026-10-22" }, mentee: null } });
      });
      await form.getByRole("radio", { name: "In person" }).check();
      await form.getByRole("radio", { name: "Student", exact: true }).check();
      await form.getByLabel("Duration (minutes)").fill("30");
      await form.getByLabel("Summary").fill("Synthetic: met at the centre.");
      await form.getByRole("button", { name: "Save Conversation" }).click();
      await expect(page.getByRole("heading", { name: "Conversation saved" })).toBeVisible();

      const key = (n: number) => `lms-documents/blended-learning/photos/${studentId}/00000000-0000-4000-8000-00000000000${n}.jpg`;
      expect(sent!.photoKeys).toEqual([key(1), key(3), key(4), key(5)]);
    });

    test("an Attempt has no photo picker", async ({ page }) => {
      await signInAs(page, BLENDED_MENTOR_A);
      await page.goto(`/blended-learning/students/${studentId}/log`);

      const form = page.getByRole("form", { name: "Log a Conversation or Attempt" });
      await expect(form.getByRole("group", { name: "Photos (optional)" })).toBeVisible();
      await form.getByRole("radio", { name: "Attempt" }).check();
      await expect(form.getByRole("group", { name: "Photos (optional)" })).toHaveCount(0);
    });
  });
}
