import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";
import { MENTEES, fullName } from "../helpers/blended-learning-fixtures";

// Blended Learning roles (#441): they land on /blended-learning and every
// other LMS page and API denies them. Personas come from seedHolisticFixtures
// (level 1, no School codes, no Programs). Run at desktop and at 360 × 740.
const MENTOR = { name: "Synthetic Blended Mentor", email: "e2e-blended-mentor@test.local" };
const BLENDED_ADMIN = { name: "Synthetic Blended Admin", email: "e2e-blended-admin@test.local" };
const READ_ONLY_ADMIN = {
  name: "Synthetic Blended Admin Read Only",
  email: "e2e-blended-admin-read-only@test.local",
};
const PROGRAM_MANAGER = { name: "E2E pm", email: "e2e-pm@test.local" };

const VIEWPORTS = [
  { label: "desktop", viewport: { width: 1280, height: 800 } },
  { label: "mobile 360", viewport: { width: 360, height: 740 } },
];

// Any JNV School in the fixture dump: Blended roles must be denied on it.
let schoolCode = "";
// Ira Attempt, the Student a well-being email would link to.
let iraId = 0;

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    const result = await pool.query<{ code: string }>(
      `SELECT code FROM school WHERE af_school_category = 'JNV' ORDER BY id LIMIT 1`
    );
    schoolCode = result.rows[0].code;
    const ira = await pool.query<{ id: string }>(`SELECT id FROM student WHERE student_id = $1`, [
      `E2E-BL-${MENTEES.attemptLatest.key}`,
    ]);
    iraId = Number(ira.rows[0].id);
  } finally {
    await pool.end();
  }
});

for (const { label, viewport } of VIEWPORTS) {
  test.describe(`Blended Learning access — ${label}`, () => {
    test.use({ viewport });

    for (const [persona, user, accessLabel] of [
      ["Mentor", MENTOR, "Mentor"],
      ["Blended Learning Admin", BLENDED_ADMIN, "Blended Learning Admin"],
      ["read-only Blended Learning Admin", READ_ONLY_ADMIN, "Blended Learning Admin · Read only"],
    ] as const) {
      test(`a ${persona} lands on /blended-learning and is denied elsewhere`, async ({ page }) => {
        await signInAs(page, user);

        await page.goto("/dashboard");
        await expect(page).toHaveURL(/\/blended-learning$/);
        await expect(page.getByRole("heading", { name: "Blended Learning" })).toBeVisible();
        await expect(page.getByText(accessLabel, { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveCount(0);

        await page.goto(`/school/${schoolCode}`);
        await expect(page.getByRole("heading", { name: "Access Denied" })).toBeVisible();

        await page.goto("/admin/users");
        await expect(page).toHaveURL(/\/blended-learning$/);

        const api = await page.request.get("/api/admin/users");
        expect(api.status()).toBe(403);
      });
    }

    test("an LMS admin sees the Blended Learning link and can open the section", async ({ adminPage }) => {
      await adminPage.goto("/dashboard");
      await adminPage.getByRole("link", { name: "Blended Learning" }).click();

      await expect(adminPage).toHaveURL(/\/blended-learning$/);
      await expect(adminPage.getByText("Blended Learning Admin", { exact: true })).toBeVisible();
      await expect(adminPage.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
    });

    test("other roles get no Blended Learning link and are sent away from the section", async ({ page }) => {
      await signInAs(page, PROGRAM_MANAGER);
      await page.goto("/dashboard");
      await expect(page.getByRole("link", { name: "Blended Learning" })).toHaveCount(0);

      await page.goto("/blended-learning");
      await expect(page).toHaveURL(/\/dashboard/);
    });

    test("a signed-out visitor is sent to sign-in", async ({ page }) => {
      await page.goto("/blended-learning");
      await expect(page).toHaveURL(/\/\?callbackUrl=%2Fblended-learning$/);
    });

    test("a signed-out reader of a well-being email's link lands on the Student after sign-in", async ({ page }) => {
      const studentPath = `/blended-learning/students/${iraId}`;
      await page.goto(studentPath);
      await expect(page).toHaveURL(new RegExp(`/\\?callbackUrl=${encodeURIComponent(studentPath)}$`));

      await page.getByRole("button", { name: /^Blended Admin\s*Blended Learning only, all Mentors/ }).click();
      await expect(page).toHaveURL(new RegExp(`${studentPath}$`));
      await expect(page.getByRole("heading", { name: fullName(MENTEES.attemptLatest) })).toBeVisible();
    });
  });
}
