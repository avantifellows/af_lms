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
  plan: {
    title: string;
    examTracks: string[];
    grade: number;
    academicYear?: string;
    closureDate?: string;
  }
): Promise<number> {
  const response = await page.request.post("/api/curriculum/plans", {
    data: {
      title: plan.title,
      exam_tracks: plan.examTracks,
      academic_year: plan.academicYear ?? "2026-2027",
      grade: plan.grade,
      closure_date: plan.closureDate ?? "2027-02-28",
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
      await expect(page.getByTestId("plan-status")).toHaveText("Draft");
      await expect(page.getByRole("button", { name: "Activate plan" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Delete plan" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Copy plan" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Copy to next year" })).toBeDisabled();

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
      const activate = await page.request.post(`/api/curriculum/plans/${planId}/activate`);
      expect(activate.status()).toBe(403);
      const remove = await page.request.delete(`/api/curriculum/plans/${planId}`);
      expect(remove.status()).toBe(403);
      for (const mode of ["same_year", "next_year"]) {
        const copy = await page.request.post(`/api/curriculum/plans/${planId}/copy`, {
          data: { mode },
        });
        expect(copy.status()).toBe(403);
      }
      const plans = await page.request.get("/api/curriculum/plans?academic_year=2026-2027&grade=11");
      expect(
        (await plans.json()).plans.filter((plan: { title: string }) =>
          plan.title.includes("E2E G11 Read-only Plan")
        )
      ).toHaveLength(1);
      const unchanged = await page.request.get(`/api/curriculum/plans/${planId}`);
      expect((await unchanged.json()).plan.status).toBe("draft");
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

  test("activating a partly dated Draft warns about undated Chapters, then shows Active with no way back to Draft", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Activate Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const saved = await adminPage.request.put(`/api/curriculum/plans/${planId}/chapters`, {
      data: { chapters: [{ chapter_id: 90007501, due_date: "2026-06-30", test_date: null }] },
    });
    expect(saved.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);
    await expect(adminPage.getByTestId("plan-status")).toHaveText("Draft");
    await adminPage.getByRole("button", { name: "Activate plan" }).click();

    const confirm = adminPage.getByTestId("plan-activate-confirm");
    await expect(confirm).toContainText("1 Chapter has no Chapter Due Date");
    await expect(confirm).toContainText("Fixture Beta Physics");
    await expect(confirm).not.toContainText("Fixture Alpha Physics");
    await confirm.getByRole("button", { name: "Activate anyway" }).click();
    await expect(adminPage.getByText("Plan activated.")).toBeVisible();

    await adminPage.reload();
    await expect(adminPage.getByTestId("plan-status")).toHaveText("Active");
    await expect(adminPage.getByRole("button", { name: "Activate plan" })).toHaveCount(0);
    await expect(adminPage.getByRole("button", { name: "Delete plan" })).toHaveCount(0);

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027&grade=11");
    await expect(
      adminPage.getByRole("row").filter({ hasText: "E2E G11 Activate Plan" })
    ).toContainText("Active");

    // Activation is one-way: a second activate is refused and the plan stays Active.
    const again = await adminPage.request.post(`/api/curriculum/plans/${planId}/activate`);
    expect(again.status()).toBe(409);
    const plan = await adminPage.request.get(`/api/curriculum/plans/${planId}`);
    expect((await plan.json()).plan.status).toBe("active");
  });

  test("deleting a Draft removes it from the list; deleting an Active plan is refused with 409", async ({
    adminPage,
  }) => {
    const draftId = await createPlan(adminPage, {
      title: "E2E G11 Delete Draft Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const activeId = await createPlan(adminPage, {
      title: "E2E G11 Delete Active Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const activated = await adminPage.request.post(`/api/curriculum/plans/${activeId}/activate`);
    expect(activated.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${draftId}`);
    await adminPage.getByRole("button", { name: "Delete plan" }).click();
    await adminPage
      .getByTestId("plan-delete-confirm")
      .getByRole("button", { name: "Confirm delete" })
      .click();
    await expect(adminPage).toHaveURL(/\/curriculum-summary\/plans\?academic_year=2026-2027&grade=11$/);
    await expect(adminPage.getByText("E2E G11 Delete Draft Plan")).toHaveCount(0);
    expect((await adminPage.request.get(`/api/curriculum/plans/${draftId}`)).status()).toBe(404);

    const refused = await adminPage.request.delete(`/api/curriculum/plans/${activeId}`);
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toBe("Only Draft plans can be deleted");
    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027&grade=11");
    await expect(
      adminPage.getByRole("row").filter({ hasText: "E2E G11 Delete Active Plan" })
    ).toContainText("Active");
  });

  test("an Active plan past its closure date shows Closed; a Draft past closure stays Draft and can be deleted", async ({
    adminPage,
  }) => {
    // Fixture rows pinned to academic year 2025-2026 so the closure date is always before
    // today (IST) without depending on the clock.
    const pool = getTestPool();
    let closedId: number;
    let staleDraftId: number;
    try {
      const inserted = await pool.query<{ id: string; status: string }>(
        `INSERT INTO lms_curriculum_plans
           (title, academic_year, grade_id, exam_tracks, status, closure_date, activated_at)
         SELECT v.title, '2025-2026', g.id, ARRAY['jee_main']::text[], v.status, '2026-03-31'::date,
                CASE WHEN v.status = 'active' THEN TIMESTAMP '2025-04-01 00:00:00' END
         FROM (VALUES ('E2E G11 Closed Plan', 'active'), ('E2E G11 Stale Draft Plan', 'draft'))
           AS v(title, status)
         CROSS JOIN LATERAL (SELECT id FROM grade WHERE number = 11 ORDER BY id LIMIT 1) g
         RETURNING id, status`
      );
      closedId = Number(inserted.rows.find((row) => row.status === "active")!.id);
      staleDraftId = Number(inserted.rows.find((row) => row.status === "draft")!.id);
    } finally {
      await pool.end();
    }

    await adminPage.goto("/curriculum-summary/plans?academic_year=2025-2026&grade=11");
    await expect(
      adminPage.getByRole("row").filter({ hasText: "E2E G11 Closed Plan" })
    ).toContainText("Closed");
    await expect(
      adminPage.getByRole("row").filter({ hasText: "E2E G11 Stale Draft Plan" })
    ).toContainText("Draft");

    await adminPage.goto(`/curriculum-summary/plans/${closedId}`);
    await expect(adminPage.getByTestId("plan-status")).toHaveText("Closed");
    await expect(adminPage.getByRole("button", { name: "Activate plan" })).toHaveCount(0);
    await expect(adminPage.getByRole("button", { name: "Delete plan" })).toHaveCount(0);
    expect((await adminPage.request.delete(`/api/curriculum/plans/${closedId}`)).status()).toBe(409);

    await adminPage.goto(`/curriculum-summary/plans/${staleDraftId}`);
    await expect(adminPage.getByTestId("plan-status")).toHaveText("Draft");
    await adminPage.getByRole("button", { name: "Delete plan" }).click();
    await adminPage
      .getByTestId("plan-delete-confirm")
      .getByRole("button", { name: "Confirm delete" })
      .click();
    await expect(adminPage).toHaveURL(/\/curriculum-summary\/plans\?academic_year=2025-2026&grade=11$/);
    await expect(adminPage.getByText("E2E G11 Stale Draft Plan")).toHaveCount(0);
    await expect(
      adminPage.getByRole("row").filter({ hasText: "E2E G11 Closed Plan" })
    ).toContainText("Closed");
  });

  test("copying to next year opens a Draft for the next academic year with every date one year later", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Copy Next Year Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const saved = await adminPage.request.put(`/api/curriculum/plans/${planId}/chapters`, {
      data: {
        chapters: [
          { chapter_id: 90007501, due_date: "2026-06-30", test_date: "2026-07-02" },
          { chapter_id: 90007502, due_date: "2027-02-28", test_date: null },
        ],
      },
    });
    expect(saved.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);
    await adminPage.getByRole("button", { name: "Copy to next year" }).click();

    await expect(adminPage).toHaveURL(/\/curriculum-summary\/plans\/\d+$/);
    await expect(adminPage).not.toHaveURL(new RegExp(`/plans/${planId}$`));
    await expect(
      adminPage.getByRole("heading", { name: "Copy of E2E G11 Copy Next Year Plan" })
    ).toBeVisible();
    await expect(adminPage.getByTestId("plan-status")).toHaveText("Draft");
    await expect(adminPage.getByLabel("Academic year")).toHaveValue("2027-2028");
    await expect(adminPage.getByLabel("Plan Closure Date")).toHaveValue("2028-02-28");
    await expect(adminPage.getByLabel("JEE Main")).toBeChecked();
    await expect(adminPage.getByLabel("JEE Advanced")).not.toBeChecked();
    await expect(adminPage.getByLabel("Due date for Fixture Alpha Physics")).toHaveValue("2027-06-30");
    await expect(adminPage.getByLabel("Test date for Fixture Alpha Physics")).toHaveValue("2027-07-02");
    await expect(adminPage.getByLabel("Due date for Fixture Beta Physics")).toHaveValue("2028-02-28");
    await expect(adminPage.getByLabel("Test date for Fixture Beta Physics")).toHaveValue("");

    // The source plan is untouched.
    const source = (await (await adminPage.request.get(`/api/curriculum/plans/${planId}`)).json()).plan;
    expect(source.title).toBe("E2E G11 Copy Next Year Plan");
    expect(source.academicYear).toBe("2026-2027");
    expect(source.closureDate).toBe("2027-02-28");
    expect(
      source.chapters.map((chapter: { chapterName: string; dueDate: string; testDate: string }) => [
        chapter.chapterName,
        chapter.dueDate,
        chapter.testDate,
      ])
    ).toEqual([
      ["Fixture Alpha Physics", "2026-06-30", "2026-07-02"],
      ["Fixture Beta Physics", "2027-02-28", null],
    ]);
  });

  test("copying to next year turns a 29 Feb date into 28 Feb", async ({ adminPage }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Leap Day Plan",
      examTracks: ["jee_main"],
      grade: 11,
      academicYear: "2027-2028",
      closureDate: "2028-02-29",
    });
    const saved = await adminPage.request.put(`/api/curriculum/plans/${planId}/chapters`, {
      data: {
        chapters: [{ chapter_id: 90007501, due_date: "2028-02-29", test_date: "2028-02-29" }],
      },
    });
    expect(saved.status()).toBe(200);

    const copied = await adminPage.request.post(`/api/curriculum/plans/${planId}/copy`, {
      data: { mode: "next_year" },
    });
    expect(copied.status()).toBe(201);
    const copy = (await copied.json()).plan;

    await adminPage.goto(`/curriculum-summary/plans/${copy.id}`);
    await expect(adminPage.getByLabel("Academic year")).toHaveValue("2028-2029");
    await expect(adminPage.getByLabel("Plan Closure Date")).toHaveValue("2029-02-28");
    await expect(adminPage.getByLabel("Due date for Fixture Alpha Physics")).toHaveValue("2029-02-28");
    await expect(adminPage.getByLabel("Test date for Fixture Alpha Physics")).toHaveValue("2029-02-28");
  });

  test("a same-year copy of an Active, assigned plan is a Draft with the same dates and no assignments", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Copy Same Year Plan",
      examTracks: ["jee_main", "jee_advanced"],
      grade: 11,
    });
    const saved = await adminPage.request.put(`/api/curriculum/plans/${planId}/chapters`, {
      data: {
        chapters: [{ chapter_id: 90007501, due_date: "2026-08-14", test_date: "2026-08-20" }],
      },
    });
    expect(saved.status()).toBe(200);
    expect((await adminPage.request.post(`/api/curriculum/plans/${planId}/activate`)).status()).toBe(200);

    // Plan Assignment authoring is a later slice; assign the source directly as fixture setup.
    const pool = getTestPool();
    try {
      await pool.query(
        `INSERT INTO lms_curriculum_plan_assignments (plan_id, centre_id, grade_id, academic_year)
         SELECT p.id, (SELECT id FROM centres ORDER BY id LIMIT 1), p.grade_id, p.academic_year
         FROM lms_curriculum_plans p
         WHERE p.id = $1`,
        [planId]
      );
    } finally {
      await pool.end();
    }

    try {
      await adminPage.goto(`/curriculum-summary/plans/${planId}`);
      await expect(adminPage.getByTestId("plan-status")).toHaveText("Active");
      await adminPage.getByRole("button", { name: "Copy plan" }).click();

      await expect(adminPage).toHaveURL(/\/curriculum-summary\/plans\/\d+$/);
      await expect(adminPage).not.toHaveURL(new RegExp(`/plans/${planId}$`));
      await expect(
        adminPage.getByRole("heading", { name: "Copy of E2E G11 Copy Same Year Plan" })
      ).toBeVisible();
      await expect(adminPage.getByTestId("plan-status")).toHaveText("Draft");
      await expect(adminPage.getByLabel("Academic year")).toHaveValue("2026-2027");
      await expect(adminPage.getByLabel("Plan Closure Date")).toHaveValue("2027-02-28");
      await expect(adminPage.getByLabel("JEE Main")).toBeChecked();
      await expect(adminPage.getByLabel("JEE Advanced")).toBeChecked();
      await expect(adminPage.getByLabel("Due date for Fixture Alpha Physics")).toHaveValue("2026-08-14");
      await expect(adminPage.getByLabel("Test date for Fixture Alpha Physics")).toHaveValue("2026-08-20");
      await expect(adminPage.getByLabel("Due date for Fixture Beta Physics")).toHaveValue("");

      const plans = (
        await (await adminPage.request.get("/api/curriculum/plans?academic_year=2026-2027&grade=11")).json()
      ).plans as Array<{ title: string; status: string; assignmentCount: number }>;
      expect(
        plans
          .filter((plan) => plan.title.endsWith("E2E G11 Copy Same Year Plan"))
          .map((plan) => [plan.title, plan.status, plan.assignmentCount])
          .sort()
      ).toEqual([
        ["Copy of E2E G11 Copy Same Year Plan", "draft", 0],
        ["E2E G11 Copy Same Year Plan", "active", 1],
      ]);
    } finally {
      const cleanup = getTestPool();
      try {
        await cleanup.query("DELETE FROM lms_curriculum_plan_assignments WHERE plan_id = $1", [planId]);
      } finally {
        await cleanup.end();
      }
    }
  });
});

// Plan Assignment (#423). Fixture Centres live at their own Schools in two fixture regions
// so the picker grouping and eligibility can be read off by name. Seeded for this block only
// and removed afterwards so no other spec sees extra JNV Schools.
const ASSIGN_PREFIX = "Plan Assign E2E ";
const ASSIGN_SCHOOLS = [
  { id: 900091, code: "PLANE2EN", name: "Plan Assign North School", category: "JNV", region: "PLAN_E2E_NORTH" },
  { id: 900092, code: "PLANE2ES", name: "Plan Assign South School", category: "JNV", region: "PLAN_E2E_SOUTH" },
  { id: 900093, code: "PLANE2EX", name: "Plan Assign Other School", category: "EMRS", region: "PLAN_E2E_NORTH" },
];
// Centre → [School id, Program id, active, physical, Grade-number:track mappings]
const ASSIGN_CENTRES: Record<string, [number, number, boolean, boolean, string[]]> = {
  Alpha: [900091, 1, true, true, ["11:jee_main", "12:neet"]],
  Bravo: [900091, 2, true, true, ["11:jee_main", "11:cet"]],
  Charlie: [900092, 1, true, true, ["11:jee_main", "11:jee_advanced"]],
  Delta: [900092, 2, true, true, ["11:jee_main"]],
  Inactive: [900091, 1, false, true, ["11:jee_main"]],
  Virtual: [900091, 2, true, false, ["11:jee_main"]],
  "Non-JNV": [900093, 1, true, true, ["11:jee_main"]],
  "G12 Only": [900092, 64, true, true, ["12:neet"]],
};

async function removeAssignFixture(): Promise<void> {
  const pool = getTestPool();
  try {
    const centres = `SELECT id FROM centres WHERE name LIKE '${ASSIGN_PREFIX}%'`;
    await pool.query(`DELETE FROM lms_curriculum_plan_assignments WHERE centre_id IN (${centres})`);
    await pool.query(`DELETE FROM centre_exam_tracks WHERE centre_id IN (${centres})`);
    await pool.query(`DELETE FROM centres WHERE name LIKE '${ASSIGN_PREFIX}%'`);
    await pool.query("DELETE FROM school WHERE id = ANY($1::bigint[])", [
      ASSIGN_SCHOOLS.map((school) => school.id),
    ]);
  } finally {
    await pool.end();
  }
}

async function seedAssignFixture(): Promise<Record<string, number>> {
  await removeAssignFixture();
  const pool = getTestPool();
  const ids: Record<string, number> = {};
  try {
    for (const school of ASSIGN_SCHOOLS) {
      await pool.query(
        `INSERT INTO school
           (id, code, name, inserted_at, updated_at, udise_code, af_school_category, region, state, district, program_ids)
         VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6, 'Gujarat', 'Ahmedabad', ARRAY[1, 2, 64]::integer[])`,
        [school.id, school.code, school.name, `9100${school.id}`, school.category, school.region]
      );
    }
    for (const [name, [schoolId, programId, isActive, isPhysical, mappings]] of Object.entries(ASSIGN_CENTRES)) {
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO centres (name, school_id, program_id, is_physical, is_active, inserted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))
         RETURNING id`,
        [`${ASSIGN_PREFIX}${name}`, schoolId, programId, isPhysical, isActive]
      );
      ids[name] = Number(inserted.rows[0].id);
      for (const mapping of mappings) {
        const [grade, track] = mapping.split(":");
        await pool.query(
          `INSERT INTO centre_exam_tracks (centre_id, grade_id, exam_track_code)
           SELECT $1, id, $3 FROM grade WHERE number = $2 ORDER BY id LIMIT 1`,
          [ids[name], Number(grade), track]
        );
      }
    }
  } finally {
    await pool.end();
  }
  return ids;
}

async function clearAssignFixtureAssignments(): Promise<void> {
  const pool = getTestPool();
  try {
    await pool.query(
      `DELETE FROM lms_curriculum_plan_assignments
       WHERE centre_id IN (SELECT id FROM centres WHERE name LIKE '${ASSIGN_PREFIX}%')`
    );
  } finally {
    await pool.end();
  }
}

function assignRow(page: Page, centre: string) {
  return page.locator("[data-assign-centre-row]").filter({ hasText: `${ASSIGN_PREFIX}${centre}` });
}

test.describe("Curriculum Plan assignment", () => {
  let centreIds: Record<string, number>;

  test.beforeAll(async () => {
    centreIds = await seedAssignFixture();
  });

  test.afterAll(async () => {
    await removeAssignFixture();
  });

  test.beforeEach(async () => {
    await clearAssignFixtureAssignments();
  });

  test("only active physical JNV Centres mapped for the plan's Grade are offered, grouped by region, and others are rejected", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Eligibility Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });

    await adminPage.goto(`/curriculum-summary/plans/${planId}/assign`);
    await expect(
      adminPage
        .getByRole("group", { name: "PLAN_E2E_NORTH" })
        .locator("[data-assign-centre-row]")
        .filter({ hasText: ASSIGN_PREFIX })
    ).toHaveText([/Plan Assign E2E Alpha/, /Plan Assign E2E Bravo/]);
    await expect(
      adminPage
        .getByRole("group", { name: "PLAN_E2E_SOUTH" })
        .locator("[data-assign-centre-row]")
        .filter({ hasText: ASSIGN_PREFIX })
    ).toHaveText([/Plan Assign E2E Charlie/, /Plan Assign E2E Delta/]);
    for (const absent of ["Inactive", "Virtual", "Non-JNV", "G12 Only"]) {
      await expect(adminPage.getByText(`${ASSIGN_PREFIX}${absent}`)).toHaveCount(0);
    }

    for (const ineligible of ["Inactive", "Virtual", "Non-JNV", "G12 Only"]) {
      const response = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
        data: { centre_ids: [centreIds.Alpha, centreIds[ineligible]] },
      });
      expect(response.status()).toBe(400);
    }
    const unknown = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
      data: { centre_ids: [999999999] },
    });
    expect(unknown.status()).toBe(400);
    // A rejected save writes nothing.
    const plan = (await (await adminPage.request.get(`/api/curriculum/plans/${planId}`)).json()).plan;
    expect(plan.assignmentCount).toBe(0);
  });

  test("assign by plan shows moves and not-covered tracks before Save, then moves the Centre onto this plan", async ({
    adminPage,
  }) => {
    const sourceId = await createPlan(adminPage, {
      title: "E2E G11 Assign Source Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const targetId = await createPlan(adminPage, {
      title: "E2E G11 Assign Target Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const seeded = await adminPage.request.put(`/api/curriculum/plans/${sourceId}/assignments`, {
      data: { centre_ids: [centreIds.Delta] },
    });
    expect(seeded.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${targetId}/assign`);
    await expect(assignRow(adminPage, "Delta")).toContainText("On E2E G11 Assign Source Plan");
    for (const centre of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      await assignRow(adminPage, centre).getByRole("checkbox").check();
    }

    await expect(adminPage.getByTestId("assign-move-count")).toHaveText(
      "1 Centre moves from another plan"
    );
    await expect(assignRow(adminPage, "Delta")).toContainText("Moves from E2E G11 Assign Source Plan");
    await expect(assignRow(adminPage, "Bravo")).toContainText("⚠ not covered: CET");
    await expect(assignRow(adminPage, "Charlie")).toContainText("⚠ not covered: JEE Advanced");
    await expect(assignRow(adminPage, "Alpha")).not.toContainText("⚠ not covered");
    await expect(assignRow(adminPage, "Delta")).not.toContainText("⚠ not covered");

    await adminPage.getByRole("button", { name: "Save assignments" }).click();
    await expect(adminPage.getByText("Assignments saved.")).toBeVisible();
    await expect(adminPage.getByTestId("assign-move-count")).toHaveText(
      "No Centres move from another plan"
    );

    await adminPage.reload();
    for (const centre of ["Alpha", "Bravo", "Charlie", "Delta"]) {
      await expect(assignRow(adminPage, centre).getByRole("checkbox")).toBeChecked();
    }
    await expect(assignRow(adminPage, "Delta")).not.toContainText("E2E G11 Assign Source Plan");

    await adminPage.goto(`/curriculum-summary/plans/${sourceId}/assign`);
    await expect(assignRow(adminPage, "Delta").getByRole("checkbox")).not.toBeChecked();
    await expect(assignRow(adminPage, "Delta")).toContainText("On E2E G11 Assign Target Plan");

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027&grade=11");
    await expect(
      adminPage.getByRole("row").filter({ hasText: "E2E G11 Assign Source Plan" }).locator("td").last()
    ).toHaveText("0");
    await expect(
      adminPage.getByRole("row").filter({ hasText: "E2E G11 Assign Target Plan" }).locator("td").last()
    ).toHaveText("4");
  });

  test("unticking an assigned Centre removes its assignment", async ({ adminPage }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Untick Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const seeded = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
      data: { centre_ids: [centreIds.Alpha, centreIds.Bravo] },
    });
    expect(seeded.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${planId}/assign`);
    await expect(assignRow(adminPage, "Bravo").getByRole("checkbox")).toBeChecked();
    await assignRow(adminPage, "Bravo").getByRole("checkbox").uncheck();
    await expect(adminPage.getByTestId("assign-move-count")).toHaveText(
      "No Centres move from another plan · 1 assignment removed"
    );
    await adminPage.getByRole("button", { name: "Save assignments" }).click();
    await expect(adminPage.getByText("Assignments saved.")).toBeVisible();

    await adminPage.reload();
    await expect(assignRow(adminPage, "Alpha").getByRole("checkbox")).toBeChecked();
    await expect(assignRow(adminPage, "Bravo").getByRole("checkbox")).not.toBeChecked();
    const plan = (await (await adminPage.request.get(`/api/curriculum/plans/${planId}`)).json()).plan;
    expect(plan.assignmentCount).toBe(1);
  });

  test("academic year and Grade are locked while the plan has a Plan Assignment", async ({
    adminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Locked Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const details = {
      title: "E2E G11 Locked Plan",
      exam_tracks: ["jee_main"],
      academic_year: "2026-2027",
      grade: 11,
      closure_date: "2027-02-28",
    };
    const seeded = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
      data: { centre_ids: [centreIds.Alpha] },
    });
    expect(seeded.status()).toBe(200);

    const regrade = await adminPage.request.patch(`/api/curriculum/plans/${planId}`, {
      data: { ...details, grade: 12 },
    });
    expect(regrade.status()).toBe(409);
    const moveYear = await adminPage.request.patch(`/api/curriculum/plans/${planId}`, {
      data: { ...details, academic_year: "2027-2028", closure_date: "2028-02-28" },
    });
    expect(moveYear.status()).toBe(409);
    // Other details stay editable.
    const rename = await adminPage.request.patch(`/api/curriculum/plans/${planId}`, {
      data: { ...details, title: "E2E G11 Locked Plan (renamed)" },
    });
    expect(rename.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);
    await expect(adminPage.getByLabel("Academic year")).toBeDisabled();
    await expect(adminPage.getByLabel("Grade")).toBeDisabled();
    await expect(adminPage.getByTestId("plan-assignment-lock")).toHaveText(
      "Academic year and Grade are locked while 1 Centre is assigned to this plan."
    );
    await expect(adminPage.getByLabel("Title")).toBeEnabled();

    // Once unassigned, they unlock.
    const cleared = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
      data: { centre_ids: [] },
    });
    expect(cleared.status()).toBe(200);
    await adminPage.reload();
    await expect(adminPage.getByLabel("Academic year")).toBeEnabled();
    await expect(adminPage.getByLabel("Grade")).toBeEnabled();
    await expect(adminPage.getByTestId("plan-assignment-lock")).toHaveCount(0);
    const regradeUnassigned = await adminPage.request.patch(`/api/curriculum/plans/${planId}`, {
      data: { ...details, grade: 12 },
    });
    expect(regradeUnassigned.status()).toBe(200);
  });

  test("the editor links to the assign page with the assigned count", async ({ adminPage }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Assign Link Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const seeded = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
      data: { centre_ids: [centreIds.Alpha, centreIds.Charlie] },
    });
    expect(seeded.status()).toBe(200);

    await adminPage.goto(`/curriculum-summary/plans/${planId}`);
    await expect(adminPage.getByTestId("plan-assignment-count")).toHaveText("2 Centres assigned");
    await adminPage.getByRole("link", { name: "Assign Centres" }).click();
    await expect(adminPage).toHaveURL(new RegExp(`/curriculum-summary/plans/${planId}/assign$`));
    await expect(
      adminPage.getByRole("heading", { name: "Assign E2E G11 Assign Link Plan" })
    ).toBeVisible();
  });

  test("read-only Admin sees the assign page with disabled controls and gets 403 on save", async ({
    adminPage,
    browser,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Read-only Assign Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const seeded = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
      data: { centre_ids: [centreIds.Alpha] },
    });
    expect(seeded.status()).toBe(200);

    const page = await readOnlyAdminPage(browser);
    try {
      await page.goto(`/curriculum-summary/plans/${planId}/assign`);
      await expect(assignRow(page, "Alpha").getByRole("checkbox")).toBeChecked();
      await expect(assignRow(page, "Alpha").getByRole("checkbox")).toBeDisabled();
      await expect(assignRow(page, "Bravo").getByRole("checkbox")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save assignments" })).toBeDisabled();

      const save = await page.request.put(`/api/curriculum/plans/${planId}/assignments`, {
        data: { centre_ids: [centreIds.Alpha, centreIds.Bravo] },
      });
      expect(save.status()).toBe(403);
      const plan = (await (await page.request.get(`/api/curriculum/plans/${planId}`)).json()).plan;
      expect(plan.assignmentCount).toBe(1);
    } finally {
      await page.context().close();
    }
  });

  test("PMs and program admins cannot open the assign page or call the assignment APIs", async ({
    adminPage,
    pmPage,
    programAdminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Denied Assign Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    for (const page of [pmPage, programAdminPage]) {
      expect((await page.request.get(`/api/curriculum/plans/${planId}/assignments`)).status()).toBe(403);
      const preview = await page.request.post(`/api/curriculum/plans/${planId}/assignments/preview`, {
        data: { centre_ids: [centreIds.Alpha] },
      });
      expect(preview.status()).toBe(403);
      const save = await page.request.put(`/api/curriculum/plans/${planId}/assignments`, {
        data: { centre_ids: [centreIds.Alpha] },
      });
      expect(save.status()).toBe(403);
      await page.goto(`/curriculum-summary/plans/${planId}/assign`);
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });
});

// Centre coverage and assign by Centre (#424), on the same fixture Centres. Alpha runs
// Grade 11 (JEE Main) and Grade 12 (NEET); "G12 Only" doesn't run Grade 11.
function coverageRow(page: Page, centre: string) {
  return page.locator("[data-coverage-row]").filter({ hasText: `${ASSIGN_PREFIX}${centre}` });
}

function coverageCell(page: Page, centre: string, grade: 11 | 12) {
  return coverageRow(page, centre).locator(`[data-coverage-grade="${grade}"]`);
}

test.describe("Curriculum Plan Centre coverage", () => {
  let centreIds: Record<string, number>;

  test.beforeAll(async () => {
    centreIds = await seedAssignFixture();
  });

  test.afterAll(async () => {
    await removeAssignFixture();
  });

  test.beforeEach(async () => {
    await clearAssignFixtureAssignments();
  });

  test("coverage lists each eligible Centre + Grade with its plan, No plan, not covered tracks and not applicable Grades", async ({
    adminPage,
  }) => {
    const g11PlanId = await createPlan(adminPage, {
      title: "E2E G11 Coverage Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const g12PlanId = await createPlan(adminPage, {
      title: "E2E G12 Coverage Plan",
      examTracks: ["neet"],
      grade: 12,
    });
    expect(
      (await adminPage.request.post(`/api/curriculum/plans/${g12PlanId}/activate`)).status()
    ).toBe(200);
    for (const [planId, centres] of [
      [g11PlanId, [centreIds.Alpha, centreIds.Bravo]],
      [g12PlanId, [centreIds["G12 Only"]]],
    ] as const) {
      const seeded = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
        data: { centre_ids: centres },
      });
      expect(seeded.status()).toBe(200);
    }

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027");
    await adminPage.getByRole("link", { name: "Centre coverage" }).click();
    await expect(adminPage).toHaveURL(/tab=coverage/);

    await expect(
      adminPage.locator("[data-coverage-row]").filter({ hasText: ASSIGN_PREFIX })
    ).toHaveText([
      /Plan Assign E2E Alpha/,
      /Plan Assign E2E Bravo/,
      /Plan Assign E2E Charlie/,
      /Plan Assign E2E Delta/,
      /Plan Assign E2E G12 Only/,
    ]);
    for (const absent of ["Inactive", "Virtual", "Non-JNV"]) {
      await expect(coverageRow(adminPage, absent)).toHaveCount(0);
    }

    await expect(coverageCell(adminPage, "Alpha", 11)).toHaveText(/E2E G11 Coverage Plan\s*Draft/);
    await expect(coverageCell(adminPage, "Alpha", 12)).toHaveText("No plan");
    await expect(coverageCell(adminPage, "Bravo", 11)).toContainText("E2E G11 Coverage Plan");
    await expect(coverageCell(adminPage, "Bravo", 11)).toContainText("⚠ not covered: CET");
    await expect(coverageCell(adminPage, "Bravo", 12)).toHaveText("Not applicable");
    await expect(coverageCell(adminPage, "Charlie", 11)).toHaveText("No plan");
    await expect(coverageCell(adminPage, "G12 Only", 11)).toHaveText("Not applicable");
    await expect(coverageCell(adminPage, "G12 Only", 12)).toHaveText(/E2E G12 Coverage Plan\s*Active/);

    // Another academic year has no plans assigned.
    await adminPage.goto("/curriculum-summary/plans?academic_year=2027-2028&tab=coverage");
    await expect(coverageCell(adminPage, "Alpha", 11)).toHaveText("No plan");
    await expect(coverageCell(adminPage, "G12 Only", 12)).toHaveText("No plan");
  });

  test("assign by Centre moves one Grade to another plan, none removes it, and the other Grade is untouched", async ({
    adminPage,
  }) => {
    const sourceId = await createPlan(adminPage, {
      title: "E2E G11 By-Centre Source Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    await createPlan(adminPage, {
      title: "E2E G11 By-Centre Target Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const g12Id = await createPlan(adminPage, {
      title: "E2E G12 By-Centre Plan",
      examTracks: ["neet"],
      grade: 12,
    });
    for (const planId of [sourceId, g12Id]) {
      const seeded = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
        data: { centre_ids: [centreIds.Alpha] },
      });
      expect(seeded.status()).toBe(200);
    }

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027&tab=coverage");
    const alpha = coverageRow(adminPage, "Alpha");
    await alpha.getByRole("button", { name: "Change plans" }).click();
    await expect(alpha.getByLabel("Grade 11 plan")).toHaveValue(String(sourceId));
    await alpha.getByLabel("Grade 11 plan").selectOption({ label: "E2E G11 By-Centre Target Plan (Draft)" });
    await alpha.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByRole("status")).toHaveText("Plans saved for Plan Assign E2E Alpha.");
    await expect(coverageCell(adminPage, "Alpha", 11)).toContainText("E2E G11 By-Centre Target Plan");

    await adminPage.reload();
    await expect(coverageCell(adminPage, "Alpha", 11)).toHaveText(/E2E G11 By-Centre Target Plan\s*Draft/);
    await expect(coverageCell(adminPage, "Alpha", 12)).toHaveText(/E2E G12 By-Centre Plan\s*Draft/);

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027");
    const assignedCount = (title: string) =>
      adminPage.getByRole("row").filter({ hasText: title }).locator("td").last();
    await expect(assignedCount("E2E G11 By-Centre Source Plan")).toHaveText("0");
    await expect(assignedCount("E2E G11 By-Centre Target Plan")).toHaveText("1");
    await expect(assignedCount("E2E G12 By-Centre Plan")).toHaveText("1");

    // Choosing none removes the Grade 11 assignment and leaves Grade 12 alone.
    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027&tab=coverage");
    await alpha.getByRole("button", { name: "Change plans" }).click();
    await alpha.getByLabel("Grade 11 plan").selectOption({ label: "No plan" });
    await alpha.getByRole("button", { name: "Save" }).click();
    await expect(adminPage.getByRole("status")).toHaveText("Plans saved for Plan Assign E2E Alpha.");

    await adminPage.reload();
    await expect(coverageCell(adminPage, "Alpha", 11)).toHaveText("No plan");
    await expect(coverageCell(adminPage, "Alpha", 12)).toHaveText(/E2E G12 By-Centre Plan\s*Draft/);
    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027");
    await expect(assignedCount("E2E G11 By-Centre Target Plan")).toHaveText("0");
    await expect(assignedCount("E2E G12 By-Centre Plan")).toHaveText("1");
  });

  test("only the academic year's plans for each Grade are offered, and mismatched plans or Grades are rejected", async ({
    adminPage,
  }) => {
    const g11Id = await createPlan(adminPage, {
      title: "E2E G11 Offered Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const g12Id = await createPlan(adminPage, {
      title: "E2E G12 Offered Plan",
      examTracks: ["neet"],
      grade: 12,
    });
    const nextYearG11Id = await createPlan(adminPage, {
      title: "E2E G11 Next Year Plan",
      examTracks: ["jee_main"],
      grade: 11,
      academicYear: "2027-2028",
      closureDate: "2028-02-28",
    });

    await adminPage.goto("/curriculum-summary/plans?academic_year=2026-2027&tab=coverage");
    const alpha = coverageRow(adminPage, "Alpha");
    await alpha.getByRole("button", { name: "Change plans" }).click();
    const g11Options = alpha.getByLabel("Grade 11 plan").locator("option");
    await expect(g11Options.filter({ hasText: "E2E G11 Offered Plan" })).toHaveCount(1);
    await expect(g11Options.filter({ hasText: "E2E G12 Offered Plan" })).toHaveCount(0);
    await expect(g11Options.filter({ hasText: "E2E G11 Next Year Plan" })).toHaveCount(0);
    await expect(g11Options.first()).toHaveText("No plan");
    const g12Options = alpha.getByLabel("Grade 12 plan").locator("option");
    await expect(g12Options.filter({ hasText: "E2E G12 Offered Plan" })).toHaveCount(1);
    await expect(g12Options.filter({ hasText: "E2E G11 Offered Plan" })).toHaveCount(0);
    // A Grade the Centre doesn't run has no picker.
    const bravo = coverageRow(adminPage, "Bravo");
    await bravo.getByRole("button", { name: "Change plans" }).click();
    await expect(bravo.getByLabel("Grade 11 plan")).toBeVisible();
    await expect(bravo.getByLabel("Grade 12 plan")).toHaveCount(0);

    const saveByCentre = (centre: string, assignments: unknown) =>
      adminPage.request.put(`/api/curriculum/plans/centres/${centreIds[centre]}/assignments`, {
        data: { academic_year: "2026-2027", assignments },
      });
    for (const [centre, assignments] of [
      ["Alpha", [{ grade: 11, plan_id: g12Id }]],
      ["Alpha", [{ grade: 11, plan_id: nextYearG11Id }]],
      ["Alpha", [{ grade: 11, plan_id: 999999999 }]],
      ["Bravo", [{ grade: 12, plan_id: g12Id }]],
      ["Inactive", [{ grade: 11, plan_id: g11Id }]],
      ["Non-JNV", [{ grade: 11, plan_id: g11Id }]],
      // One bad Grade rejects the whole request.
      ["Alpha", [{ grade: 11, plan_id: g11Id }, { grade: 12, plan_id: g11Id }]],
    ] as const) {
      const response = await saveByCentre(centre, assignments);
      expect(response.status()).toBe(400);
    }
    for (const planId of [g11Id, g12Id, nextYearG11Id]) {
      const plan = (await (await adminPage.request.get(`/api/curriculum/plans/${planId}`)).json()).plan;
      expect(plan.assignmentCount).toBe(0);
    }

    const valid = await saveByCentre("Alpha", [
      { grade: 11, plan_id: g11Id },
      { grade: 12, plan_id: g12Id },
    ]);
    expect(valid.status()).toBe(200);
    await adminPage.reload();
    await expect(coverageCell(adminPage, "Alpha", 11)).toContainText("E2E G11 Offered Plan");
    await expect(coverageCell(adminPage, "Alpha", 12)).toContainText("E2E G12 Offered Plan");
  });

  test("read-only Admin sees coverage with disabled controls and gets 403 on save; PMs and program admins get 403", async ({
    adminPage,
    browser,
    pmPage,
    programAdminPage,
  }) => {
    const planId = await createPlan(adminPage, {
      title: "E2E G11 Read-only Coverage Plan",
      examTracks: ["jee_main"],
      grade: 11,
    });
    const seeded = await adminPage.request.put(`/api/curriculum/plans/${planId}/assignments`, {
      data: { centre_ids: [centreIds.Alpha] },
    });
    expect(seeded.status()).toBe(200);
    const body = { academic_year: "2026-2027", assignments: [{ grade: 11, plan_id: null }] };

    const page = await readOnlyAdminPage(browser);
    try {
      await page.goto("/curriculum-summary/plans?academic_year=2026-2027");
      await page.getByRole("link", { name: "Centre coverage" }).click();
      await expect(coverageCell(page, "Alpha", 11)).toContainText("E2E G11 Read-only Coverage Plan");
      await expect(coverageRow(page, "Alpha").getByRole("button", { name: "Change plans" })).toBeDisabled();
      await expect(coverageRow(page, "Charlie").getByRole("button", { name: "Change plans" })).toBeDisabled();

      const save = await page.request.put(`/api/curriculum/plans/centres/${centreIds.Alpha}/assignments`, {
        data: body,
      });
      expect(save.status()).toBe(403);
    } finally {
      await page.context().close();
    }
    for (const deniedPage of [pmPage, programAdminPage]) {
      const save = await deniedPage.request.put(
        `/api/curriculum/plans/centres/${centreIds.Alpha}/assignments`,
        { data: body }
      );
      expect(save.status()).toBe(403);
      await deniedPage.goto("/curriculum-summary/plans?tab=coverage");
      await expect(deniedPage).toHaveURL(/\/dashboard/);
    }
    const plan = (await (await adminPage.request.get(`/api/curriculum/plans/${planId}`)).json()).plan;
    expect(plan.assignmentCount).toBe(1);
  });
});
