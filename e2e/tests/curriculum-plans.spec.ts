import type { Browser, Page } from "@playwright/test";
import { test, expect, signInAs } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

// Curriculum Plans authoring (#420). The e2e curriculum fixture
// (20260530043000_add_lms_curriculum_read_path.sql) gives Grade 11 two in-syllabus
// Physics Chapters: Fixture Alpha Physics (JEE Main seq 1, JEE Advanced seq 2) and
// Fixture Beta Physics (JEE Main seq 1). Fixture Chemistry is out of syllabus.
// Expected values below are worked out by hand from those rows.

async function createPlan(
  page: Page,
  plan: { title: string; examTracks: string[]; grade: number }
): Promise<number> {
  const response = await page.request.post("/api/curriculum/plans", {
    data: {
      title: plan.title,
      exam_tracks: plan.examTracks,
      academic_year: "2026-2027",
      grade: plan.grade,
      closure_date: "2027-02-28",
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).plan.id;
}

// "Admin (Read Only)" is role admin + read_only (#249); seeded for this spec only.
const READ_ONLY_ADMIN = { name: "E2E Read-only Admin", email: "e2e-readonly-admin@test.local" };

test.beforeAll(async () => {
  const pool = getTestPool();
  try {
    await pool.query(
      `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only)
       VALUES ($1, 3, 'admin', ARRAY[1, 2, 64]::integer[], NULL, NULL, true)
       ON CONFLICT (email) DO UPDATE SET
         level = 3, role = 'admin', read_only = true, revoked_at = NULL`,
      [READ_ONLY_ADMIN.email]
    );
  } finally {
    await pool.end();
  }
});

test.afterAll(async () => {
  const pool = getTestPool();
  try {
    await pool.query("DELETE FROM user_permission WHERE email = $1", [READ_ONLY_ADMIN.email]);
  } finally {
    await pool.end();
  }
});

async function readOnlyAdminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, READ_ONLY_ADMIN);
  return page;
}

// Syllabus changes are fixture setup (Curriculum Config owns them); always restore the
// fixture's 120 prescribed minutes. Out-of-syllabus rows must carry 0 minutes.
async function setBetaJeeMainInSyllabus(isInSyllabus: boolean): Promise<void> {
  const pool = getTestPool();
  try {
    await pool.query(
      `UPDATE lms_chapter_exam_configs
       SET is_in_syllabus = $1,
           prescribed_minutes = CASE WHEN $1 THEN 120 ELSE 0 END
       WHERE chapter_id = 90007502 AND exam_track = 'jee_main'`,
      [isInSyllabus]
    );
  } finally {
    await pool.end();
  }
}

function chapterRow(page: Page, chapterName: string) {
  return page.locator("[data-plan-chapter-row]").filter({ hasText: chapterName });
}

test.describe("Curriculum Plans", () => {
  test("admin creates a plan, lands on its editor, and sees it as Draft in the plans list", async ({
    adminPage,
  }) => {
    await adminPage.goto("/curriculum-summary/plans/new");
    await adminPage.getByLabel("Title").fill("E2E G11 Create Plan");
    await adminPage.getByLabel("JEE Main").check();
    await adminPage.getByLabel("JEE Advanced").check();
    await adminPage.getByLabel("Academic year").fill("2026-2027");
    await adminPage.getByLabel("Grade").selectOption("11");
    await adminPage.getByLabel("Plan Closure Date").fill("2027-02-28");
    await adminPage.getByRole("button", { name: "Create plan" }).click();

    await expect(adminPage).toHaveURL(/\/curriculum-summary\/plans\/\d+$/);
    await expect(
      adminPage.getByRole("heading", { name: "E2E G11 Create Plan" })
    ).toBeVisible();

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027");
    const row = adminPage
      .getByRole("row")
      .filter({ hasText: "E2E G11 Create Plan" });
    await expect(row).toContainText("Draft");
    await expect(row).toContainText("JEE Main, JEE Advanced");
    await expect(row).toContainText("2027-02-28");
  });

  test("editor lists every in-syllabus Chapter once, grouped by subject in syllabus order", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Chapter List Plan",
      examTracks: ["jee_main", "jee_advanced"],
      grade: 11,
    });

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);

    const physics = adminPage.getByRole("region", { name: "Physics" });
    await expect(physics.locator("[data-plan-chapter-row]")).toHaveText([
      /Fixture Alpha Physics/,
      /Fixture Beta Physics/,
    ]);
    await expect(chapterRow(adminPage, "Fixture Alpha Physics")).toContainText("Not in plan");
    await expect(chapterRow(adminPage, "Fixture Beta Physics")).toContainText("Not in plan");
    // Out of syllabus for JEE Advanced and unconfigured for JEE Main.
    await expect(adminPage.getByText("Fixture Chemistry")).toHaveCount(0);
    // Grade 12 NEET content is not part of a Grade 11 JEE plan.
    await expect(adminPage.getByText("Fixture Biology")).toHaveCount(0);
  });

  test("saved Chapter dates persist across reload and a test date before its due date warns", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Dating Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);
    await adminPage.getByLabel("Due date for Fixture Alpha Physics").fill("2026-06-30");
    await adminPage.getByLabel("Test date for Fixture Alpha Physics").fill("2026-06-25");
    await adminPage.getByLabel("Due date for Fixture Beta Physics").fill("2026-07-15");
    await adminPage.getByRole("button", { name: "Save Chapter dates" }).click();

    await expect(adminPage.getByText("Chapter dates saved.")).toBeVisible();
    await expect(adminPage.getByTestId("plan-date-warnings")).toContainText(
      "Fixture Alpha Physics: Chapter Test Date is before its Chapter Due Date"
    );

    await adminPage.reload();
    await expect(adminPage.getByLabel("Due date for Fixture Alpha Physics")).toHaveValue("2026-06-30");
    await expect(adminPage.getByLabel("Test date for Fixture Alpha Physics")).toHaveValue("2026-06-25");
    await expect(adminPage.getByLabel("Due date for Fixture Beta Physics")).toHaveValue("2026-07-15");
    await expect(adminPage.getByLabel("Test date for Fixture Beta Physics")).toHaveValue("");
    await expect(chapterRow(adminPage, "Fixture Alpha Physics")).not.toContainText("Not in plan");
  });

  test("invalid Chapter dates are rejected with the offending Chapters named and nothing saved", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Invalid Dates Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);
    // Closure is 2027-02-28 and academic year 2026-2027 ends 2027-03-31.
    await adminPage.getByLabel("Due date for Fixture Alpha Physics").fill("2027-03-10");
    await adminPage.getByLabel("Test date for Fixture Alpha Physics").fill("2027-04-05");
    await adminPage.getByLabel("Test date for Fixture Beta Physics").fill("2026-08-01");
    await adminPage.getByRole("button", { name: "Save Chapter dates" }).click();

    const alert = adminPage.getByTestId("plan-date-errors");
    await expect(alert).toContainText("Chapter dates were not saved.");
    await expect(alert).toContainText(
      "Fixture Alpha Physics: Chapter Due Date 2027-03-10 is after the Plan Closure Date 2027-02-28"
    );
    await expect(alert).toContainText(
      "Fixture Alpha Physics: Chapter Test Date 2027-04-05 is outside academic year 2026-2027"
    );
    await expect(alert).toContainText(
      "Fixture Beta Physics: Chapter Test Date needs a Chapter Due Date"
    );

    await adminPage.reload();
    await expect(adminPage.getByLabel("Due date for Fixture Alpha Physics")).toHaveValue("");
    await expect(adminPage.getByLabel("Test date for Fixture Alpha Physics")).toHaveValue("");
    await expect(adminPage.getByLabel("Test date for Fixture Beta Physics")).toHaveValue("");
  });

  test("a Chapter removed from syllabus disappears but its stored date returns when re-added", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Syllabus Change Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const saved = await adminPage.request.put(`/api/curriculum/plans/${planId}/chapters`, {
      data: { chapters: [{ chapter_id: 90007502, due_date: "2026-07-15", test_date: null }] },
    });
    expect(saved.status()).toBe(200);

    try {
      await setBetaJeeMainInSyllabus(false);
      await adminPage.goto(`/curriculum-summary/plans/${planId}`);
      await expect(chapterRow(adminPage, "Fixture Alpha Physics")).toBeVisible();
      await expect(adminPage.getByText("Fixture Beta Physics")).toHaveCount(0);
    } finally {
      await setBetaJeeMainInSyllabus(true);
    }

    await adminPage.reload();
    await expect(adminPage.getByLabel("Due date for Fixture Beta Physics")).toHaveValue("2026-07-15");
  });

  test("the Plans button shows for Admins, including read-only, and not for PMs or program admins", async ({
    adminPage,
    pmPage,
    programAdminPage,
    browser,
  }) => {
    await adminPage.goto("/curriculum-summary");
    await adminPage.getByRole("link", { name: "Plans", exact: true }).click();
    await expect(
      adminPage.getByRole("heading", { name: "Curriculum Plans", exact: true })
    ).toBeVisible();

    const readOnlyPage = await readOnlyAdminPage(browser);
    await readOnlyPage.goto("/curriculum-summary");
    await expect(readOnlyPage.getByRole("link", { name: "Plans", exact: true })).toBeVisible();
    await readOnlyPage.context().close();

    await pmPage.goto("/curriculum-summary");
    await expect(pmPage.getByRole("heading", { name: "Curriculum Summary", exact: true })).toBeVisible();
    await expect(pmPage.getByRole("link", { name: "Plans", exact: true })).toHaveCount(0);

    await programAdminPage.goto("/curriculum-summary");
    await expect(
      programAdminPage.getByRole("heading", { name: "Curriculum Summary", exact: true })
    ).toBeVisible();
    await expect(programAdminPage.getByRole("link", { name: "Plans", exact: true })).toHaveCount(0);
  });

  test("read-only Admin views the list and editor with disabled controls and gets 403 from write APIs", async ({
    adminPage,
    browser,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Read-only Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const page = await readOnlyAdminPage(browser);
    try {
      await page.goto("/curriculum-summary/plans?academic_year=2026-2027");
      await expect(page.getByRole("row").filter({ hasText: "E2E G11 Read-only Plan" })).toContainText("Draft");
      await expect(page.getByRole("button", { name: "New plan" })).toBeDisabled();

      await page.goto(`/curriculum-summary/plans/${planId}`);
      await expect(page.getByRole("heading", { name: "E2E G11 Read-only Plan" })).toBeVisible();
      await expect(page.getByLabel("Title")).toBeDisabled();
      await expect(page.getByLabel("JEE Main")).toBeDisabled();
      await expect(page.getByLabel("Plan Closure Date")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save plan details" })).toBeDisabled();
      await expect(page.getByLabel("Due date for Fixture Alpha Physics")).toBeDisabled();
      await expect(page.getByLabel("Test date for Fixture Alpha Physics")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save Chapter dates" })).toBeDisabled();

      const create = await page.request.post("/api/curriculum/plans", {
        data: {
          title: "Read-only attempt",
          exam_tracks: ["jee_main"],
          academic_year: "2026-2027",
          grade: 11,
          closure_date: "2027-02-28",
        },
      });
      expect(create.status()).toBe(403);
      const dates = await page.request.put(`/api/curriculum/plans/${planId}/chapters`, {
        data: { chapters: [{ chapter_id: 90007501, due_date: "2026-06-30", test_date: null }] },
      });
      expect(dates.status()).toBe(403);
      const list = await page.request.get("/api/curriculum/plans?academic_year=2026-2027");
      expect(list.status()).toBe(200);
    } finally {
      await page.context().close();
    }
  });

  test("PMs and program admins get 403 from plan APIs and cannot open plan pages", async ({
    adminPage,
    pmPage,
    programAdminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Denied Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });

    for (const page of [pmPage, programAdminPage]) {
      expect((await page.request.get("/api/curriculum/plans")).status()).toBe(403);
      expect((await page.request.get(`/api/curriculum/plans/${planId}`)).status()).toBe(403);
      const write = await page.request.put(`/api/curriculum/plans/${planId}/chapters`, {
        data: { chapters: [{ chapter_id: 90007501, due_date: "2026-06-30", test_date: null }] },
      });
      expect(write.status()).toBe(403);

      for (const path of [
        "/curriculum-summary/plans",
        "/curriculum-summary/plans/new",
        `/curriculum-summary/plans/${planId}`,
      ]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/dashboard/);
      }
    }
  });

  test("admin updates plan details, and a closure date before a stored Chapter date is rejected", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Metadata Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const saved = await adminPage.request.put(`/api/curriculum/plans/${planId}/chapters`, {
      data: { chapters: [{ chapter_id: 90007501, due_date: "2026-12-15", test_date: null }] },
    });
    expect(saved.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);
    await adminPage.getByLabel("Plan Closure Date").fill("2026-11-30");
    await adminPage.getByRole("button", { name: "Save plan details" }).click();
    await expect(adminPage.getByTestId("plan-details-errors")).toContainText(
      "Fixture Alpha Physics: Chapter Due Date 2026-12-15 is after the Plan Closure Date 2026-11-30"
    );

    await adminPage.getByLabel("Title").fill("E2E G11 Metadata Plan (renamed)");
    await adminPage.getByLabel("JEE Advanced").check();
    await adminPage.getByLabel("Plan Closure Date").fill("2027-01-31");
    await adminPage.getByRole("button", { name: "Save plan details" }).click();
    await expect(adminPage.getByText("Plan details saved.")).toBeVisible();

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027&grade=11");
    const row = adminPage.getByRole("row").filter({ hasText: "E2E G11 Metadata Plan (renamed)" });
    await expect(row).toContainText("JEE Main, JEE Advanced");
    await expect(row).toContainText("2027-01-31");
  });

  test("plan APIs reject invalid plan details with 400", async ({ adminPage }) => {
    const valid = {
      title: "E2E Invalid Details",
      exam_tracks: ["jee_main"],
      academic_year: "2026-2027",
      grade: 11,
      closure_date: "2027-02-28",
    };
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ exam_tracks: [] }, "Choose at least one served Exam Track"],
      [{ exam_tracks: ["jee_main", "cet"] }, "Served Exam Tracks must be JEE Main, JEE Advanced or NEET"],
      [{ academic_year: "2026-2028" }, "Academic year must look like 2026-2027"],
      [{ grade: 10 }, "Grade must be 11 or 12"],
      [{ closure_date: "2027-04-01" }, "Plan Closure Date must fall within academic year 2026-2027"],
    ];
    for (const [override, message] of cases) {
      const response = await adminPage.request.post("/api/curriculum/plans", {
        data: { ...valid, ...override },
      });
      expect(response.status()).toBe(400);
      const json = await response.json();
      expect(json.errors.map((error: { message: string }) => error.message)).toContain(message);
    }
  });
});
