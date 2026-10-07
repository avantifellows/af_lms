import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { getTestPool } from "../helpers/db";

// Dedicated actor so no other spec's Visits (the shared E2E PM reuses its own
// email) can leak into this count, and cleanup can't disturb theirs.
const ACTOR_EMAIL = "e2e-visit-total-pm@test.local";
const ACTOR_VARIANT_EMAIL = "  E2E-Visit-Total-PM@Test.LOCAL ";
const OTHER_PM_EMAIL = "e2e-visit-total-other-pm@test.local";

// Enumerated fixture: 7 owned non-deleted Visits (both statuses, two of them
// stored under a case/whitespace variant), plus one other-owner Visit and one
// owned soft-deleted Visit that must not count.
const EXPECTED_TOTAL = "7";

const NEXTAUTH_SECRET = "e2e-test-secret-at-least-32-chars-long";

async function signInAsActor(page: Page) {
  const token = await encode({
    token: { name: "E2E Visit Total PM", email: ACTOR_EMAIL, sub: "e2e-visit-total-pm-sub" },
    secret: NEXTAUTH_SECRET,
  });
  await page.context().addCookies([{
    name: "next-auth.session-token",
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
}

function totalVisitsValue(page: Page) {
  return page.getByText("Total Visits", { exact: true }).locator("xpath=following-sibling::div[1]");
}

function recentVisitRows(page: Page) {
  return page
    .getByRole("heading", { name: "Recent Visits" })
    .locator("xpath=ancestor::div[contains(@class,'mb-8')][1]")
    .locator("tbody tr");
}

test.describe("Dashboard — Total Visits", () => {
  const pool = getTestPool();
  let newestVariantVisitId: number;

  test.beforeAll(async () => {
    // Any School works: the total counts by owner, not by School scope.
    const school = await pool.query<{ code: string }>(
      `SELECT code FROM school ORDER BY code LIMIT 1`
    );
    const schoolCode = school.rows[0].code;

    await pool.query(
      `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only, revoked_at)
       VALUES ($1, 2, 'program_manager', $2, NULL, $3, false, NULL)
       ON CONFLICT (email) DO UPDATE SET
         level = EXCLUDED.level, role = EXCLUDED.role, program_ids = EXCLUDED.program_ids,
         school_codes = NULL, regions = EXCLUDED.regions, read_only = false, revoked_at = NULL`,
      [ACTOR_EMAIL, [1, 2], ["AHMEDABAD"]]
    );

    const visits: Array<[email: string, date: string, status: string, deleted: boolean]> = [
      [ACTOR_EMAIL, "2026-01-01", "completed", false],
      [ACTOR_EMAIL, "2026-01-02", "in_progress", false],
      [ACTOR_EMAIL, "2026-01-03", "completed", false],
      [ACTOR_EMAIL, "2026-01-04", "in_progress", false],
      [ACTOR_EMAIL, "2026-01-05", "completed", false],
      [ACTOR_VARIANT_EMAIL, "2026-01-06", "completed", false],
      [ACTOR_VARIANT_EMAIL, "2026-01-07", "in_progress", false], // newest owned
      [OTHER_PM_EMAIL, "2026-01-08", "completed", false],
      [ACTOR_EMAIL, "2026-01-09", "in_progress", true],
    ];
    for (const [email, date, status, deleted] of visits) {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO lms_pm_school_visits
           (school_code, pm_email, visit_date, status, completed_at, deleted_at)
         VALUES ($1, $2, $3::date, $4::varchar,
                 CASE WHEN $4::varchar = 'completed' THEN NOW() END,
                 CASE WHEN $5::boolean THEN NOW() END)
         RETURNING id`,
        [schoolCode, email, date, status, deleted]
      );
      if (date === "2026-01-07") newestVariantVisitId = Number(result.rows[0].id);
    }
  });

  test.afterAll(async () => {
    try {
      await pool.query(
        `DELETE FROM lms_pm_school_visits
         WHERE LOWER(TRIM(pm_email)) IN (LOWER(TRIM($1)), LOWER(TRIM($2)))`,
        [ACTOR_EMAIL, OTHER_PM_EMAIL]
      );
      await pool.query(`DELETE FROM user_permission WHERE email = $1`, [ACTOR_EMAIL]);
    } finally {
      await pool.end();
    }
  });

  test("JNV NVS Schools shows the exact total and at most five Recent Visits", async ({ page }) => {
    await signInAsActor(page);

    for (const url of ["/dashboard?view=jnv-nvs", "/dashboard?view=jnv-nvs&q=zzz-no-match"]) {
      await page.goto(url);
      await expect(totalVisitsValue(page)).toHaveText(EXPECTED_TOTAL);
      await expect(recentVisitRows(page)).toHaveCount(5);
      // The newest owned Visit is stored under the case/whitespace variant.
      await expect(recentVisitRows(page).first().getByRole("link")).toHaveAttribute(
        "href",
        `/visits/${newestVariantVisitId}`
      );
    }
  });

  test("Physical Centres shows the same exact total and no Recent Visits", async ({ page }) => {
    await signInAsActor(page);

    for (const url of ["/dashboard?view=centres", "/dashboard?view=centres&q=zzz-no-match"]) {
      await page.goto(url);
      await expect(totalVisitsValue(page)).toHaveText(EXPECTED_TOTAL);
      await expect(page.getByRole("heading", { name: "Recent Visits" })).toHaveCount(0);
    }
  });
});
