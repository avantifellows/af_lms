import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

// The Holistic fixture seeds one categorized submitted Note: the second Grade 12
// Student on "Synthetic Grade 12 Skipped" (Phase 4) carries Exam/Test related
// issues and Time management & distractions. Nothing else on that Phase is tagged.
type Fixture = {
  centreId: number;
  schoolName: string;
  categorizedPhaseId: number;
  mappingSchoolCount: number;
};

let fixture: Fixture;

const EXPECTED_ROW = [
  "0.0%", "0.0%", "100.0%", "0.0%", "0.0%", "0.0%",
  "100.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%",
];

type BrowserHealth = { consoleErrors: string[]; pageErrors: string[]; networkErrors: string[] };

function collectBrowserHealth(page: Page): BrowserHealth {
  const health: BrowserHealth = { consoleErrors: [], pageErrors: [], networkErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") health.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => health.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/holistic-mentorship/") && response.status() >= 500) {
      health.networkErrors.push(`${response.request().method()} ${response.url()} - HTTP ${response.status()}`);
    }
  });
  return health;
}

function expectBrowserHealth(health: BrowserHealth) {
  expect(health.consoleErrors, "browser console errors").toEqual([]);
  expect(health.pageErrors, "uncaught browser errors").toEqual([]);
  expect(health.networkErrors, "Holistic Mentorship network errors").toEqual([]);
}

// Multi-Program viewers land on All Programs; these checks are about Program 1.
async function openHeatmap(page: Page) {
  await page.goto("/admin/holistic-mentorship?program_id=1");
  await expect(page.getByRole("heading", { name: "Holistic Mentorship" })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Holistic Mentorship sections" }).getByRole("tab");
  await page.getByRole("tab", { name: "Challenge Categories" }).click();
  await expect(page.getByRole("heading", { name: "Challenge Categories" })).toBeVisible();
  await page.getByLabel("Program", { exact: true }).selectOption("1");
  return tabs;
}

function programOptions(page: Page) {
  return page.getByLabel("Program", { exact: true }).locator("option");
}

async function selectCategorizedPhase(page: Page) {
  await page.getByLabel("Grade", { exact: true }).selectOption("12");
  const phase = page.getByLabel("Phase", { exact: true });
  await expect(phase.locator(`option[value="${fixture.categorizedPhaseId}"]`)).toHaveCount(1);
  await expect(phase).toBeEnabled();
  await phase.selectOption(String(fixture.categorizedPhaseId));
  return page.getByRole("table", { name: "Challenge Category Heatmap" });
}

test.describe("Challenge Category Heatmap", () => {
  test.beforeAll(async () => {
    const pool = getTestPool();
    try {
      const { rows: [row] } = await pool.query<{
        centre_id: string; school_name: string; categorized_phase_id: string; mapping_school_count: string;
      }>(
        `SELECT centre.id AS centre_id, school.name AS school_name,
                (SELECT phase.id FROM holistic_mentorship_phases phase
                 JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
                 WHERE plan.program_id = 1 AND plan.academic_year = '2026-2027'
                   AND phase.title = 'Synthetic Grade 12 Skipped') AS categorized_phase_id,
                (SELECT COUNT(DISTINCT mapping.school_id) FROM holistic_mentorship_mentor_mentee_mappings mapping
                 WHERE mapping.program_id = 1 AND mapping.academic_year = '2026-2027') AS mapping_school_count
         FROM user_permission fixture_permission
         JOIN school ON school.code = fixture_permission.school_codes[1]
         JOIN centres centre ON centre.school_id = school.id AND centre.program_id = 1 AND centre.is_active IS TRUE
         WHERE LOWER(fixture_permission.email) = 'e2e-holistic-teacher@test.local'
         ORDER BY centre.id LIMIT 1`,
      );
      fixture = {
        centreId: Number(row.centre_id),
        schoolName: row.school_name,
        categorizedPhaseId: Number(row.categorized_phase_id),
        mappingSchoolCount: Number(row.mapping_school_count),
      };
    } finally {
      await pool.end();
    }
  });

  test("the tab sits between Students & Progress and Phase Setup for every program_read role", async ({
    adminPage,
    holisticAdminPage,
    holisticPmPage,
    holisticProgramAdminPage,
  }) => {
    for (const [page, tabs] of [
      [adminPage, ["Students & Progress", "Challenge Categories", "Phase Setup"]],
      [holisticAdminPage, ["Students & Progress", "Challenge Categories", "Phase Setup"]],
      [holisticPmPage, ["Students & Progress", "Challenge Categories"]],
      [holisticProgramAdminPage, ["Students & Progress", "Challenge Categories"]],
    ] as const) {
      const health = collectBrowserHealth(page);
      await expect(await openHeatmap(page)).toHaveText([...tabs]);
      await expect(page.getByLabel("Grade", { exact: true })).toHaveValue("11");
      await expect(page.getByLabel("Phase", { exact: true })).toBeEnabled();
      expectBrowserHealth(health);
    }
  });

  test("a Teacher's School-page workspace has no Challenge Categories tab and the API denies them", async ({
    holisticTeacherPage,
  }) => {
    const health = collectBrowserHealth(holisticTeacherPage);
    await holisticTeacherPage.goto(`/centre/${fixture.centreId}`);
    await holisticTeacherPage.getByRole("tab", { name: "Holistic Mentorship", exact: true }).click();
    await expect(holisticTeacherPage.getByRole("heading", { name: "My Mentees" })).toBeVisible();
    await expect(holisticTeacherPage.getByRole("tab", { name: "Challenge Categories" })).toHaveCount(0);

    const response = await holisticTeacherPage.request.get(
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=11",
    );
    expect(response.status()).toBe(403);
    expectBrowserHealth(health);
  });

  test("the seeded categorized Note renders exact cells, n, All Schools and the hidden-School note", async ({
    holisticAdminPage,
    holisticPmPage,
  }) => {
    for (const page of [holisticAdminPage, holisticPmPage]) {
      const health = collectBrowserHealth(page);
      await openHeatmap(page);
      const table = await selectCategorizedPhase(page);
      await expect(page.getByLabel("Phase", { exact: true })).toHaveValue(String(fixture.categorizedPhaseId));

      const rows = table.getByRole("row");
      // Two header rows, All Schools, then the fixture School.
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(2).getByRole("rowheader")).toHaveText(/All Schools\s*n = 1/);
      await expect(rows.nth(2).getByRole("cell")).toHaveText(EXPECTED_ROW);
      await expect(rows.nth(3).getByRole("rowheader")).toHaveText(new RegExp(`${fixture.schoolName}\\s*n = 1`));
      await expect(rows.nth(3).getByRole("cell")).toHaveText(EXPECTED_ROW);
      await expect(table.getByRole("columnheader", { name: "Academic: Exam/Test related issues" })).toBeVisible();

      // Program-wide readers see every Mapping School; a PM's region may hold fewer.
      if (page === holisticAdminPage) {
        const hidden = fixture.mappingSchoolCount - 1;
        const note = hidden === 1
          ? "1 School has no categorized Notes yet"
          : `${hidden} Schools have no categorized Notes yet`;
        if (hidden > 0) await expect(page.getByText(note, { exact: true })).toBeVisible();
        else await expect(page.getByText(/no categorized Notes yet$/)).toHaveCount(0);
      }
      expectBrowserHealth(health);
    }
  });

  test("Grade 11's latest Open Phase has no categorized Notes, so every Mapping School is hidden", async ({
    holisticAdminPage,
  }) => {
    const health = collectBrowserHealth(holisticAdminPage);
    await openHeatmap(holisticAdminPage);

    await expect(holisticAdminPage.getByLabel("Phase", { exact: true }).locator("option:checked"))
      .toHaveText("Phase 2 - Synthetic Grade 11 Active");
    await expect(holisticAdminPage.getByText(
      "No submitted Post-Session Notes with Challenge Categories match this selection yet.",
    )).toBeVisible();
    await expect(holisticAdminPage.getByRole("table", { name: "Challenge Category Heatmap" })).toHaveCount(0);
    const note = fixture.mappingSchoolCount === 1
      ? "1 School has no categorized Notes yet"
      : `${fixture.mappingSchoolCount} Schools have no categorized Notes yet`;
    await expect(holisticAdminPage.getByText(note, { exact: true })).toBeVisible();
    expectBrowserHealth(health);
  });

  test("All Programs locks Phase on the heatmap tab only, and other tabs keep the single Program", async ({
    holisticAdminPage: page,
  }) => {
    const health = collectBrowserHealth(page);
    await page.goto("/admin/holistic-mentorship?program_id=1");
    const program = page.getByLabel("Program", { exact: true });
    await expect(program).toHaveValue("1");
    await expect(programOptions(page).filter({ hasText: "All Programs" })).toHaveCount(0);

    await page.getByRole("tab", { name: "Challenge Categories" }).click();
    await expect(program).toHaveValue("all");
    await expect(program.locator("option:checked")).toHaveText("All Programs");
    const phase = page.getByLabel("Phase", { exact: true });
    await expect(phase).toBeDisabled();
    await expect(phase.locator("option")).toHaveText(["All Phases"]);
    await page.getByLabel("Grade", { exact: true }).selectOption("12");
    // The seeded Program 1 Grade 12 Note is among every Program's Notes.
    await expect(page.getByRole("table", { name: "Challenge Category Heatmap" })).toBeVisible();
    await expect(phase).toBeDisabled();
    await expect(phase.locator("option")).toHaveText(["All Phases"]);

    for (const tab of ["Phase Setup", "Students & Progress"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(program).toHaveValue("1");
      await expect(programOptions(page).filter({ hasText: "All Programs" })).toHaveCount(0);
    }
    await expect(page).toHaveURL(/[?&]program_id=1(&|$)/);

    const response = await page.request.get(
      `/api/holistic-mentorship/challenge-categories?program_id=all&academic_year=2026-2027&grade=12&phase_id=${fixture.categorizedPhaseId}`,
    );
    expect(response.status()).toBe(422);
    expectBrowserHealth(health);
  });

  test("a single-Program PM opens the heatmap on their Program with no All Programs option", async ({
    holisticPmPage: page,
  }) => {
    const health = collectBrowserHealth(page);
    await page.goto("/admin/holistic-mentorship");
    await page.getByRole("tab", { name: "Challenge Categories" }).click();
    await expect(page.getByLabel("Program", { exact: true })).toHaveValue("1");
    await expect(programOptions(page)).toHaveCount(1);
    await expect(page.getByLabel("Phase", { exact: true })).toBeEnabled();
    expectBrowserHealth(health);
  });

  test("the grid scrolls horizontally at phone width without page overflow", async ({ holisticPmPage }) => {
    const health = collectBrowserHealth(holisticPmPage);
    await holisticPmPage.setViewportSize({ width: 375, height: 800 });
    await openHeatmap(holisticPmPage);
    const table = await selectCategorizedPhase(holisticPmPage);
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Non-academic: Time management & distractions" }))
      .toHaveAttribute("title", "Time management & distractions");
    await expect(table.getByText("Time", { exact: true })).toBeVisible();

    const layout = await table.evaluate((element) => {
      const container = element.parentElement!;
      const bounds = container.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        viewport: document.documentElement.clientWidth,
        scrollable: container.scrollWidth > container.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(layout.scrollable).toBe(true);
    expect(layout.left).toBeGreaterThanOrEqual(-1);
    expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.pageOverflow).toBe(false);
    expectBrowserHealth(health);
  });
});
