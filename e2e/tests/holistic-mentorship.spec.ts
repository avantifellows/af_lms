import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

type Fixture = {
  schoolCode: string;
  draftStudentId: number;
  unassignedStudentId: number;
  formerStudentId: number;
  profileGrade11StudentId: number;
  historicalGrade12StudentId: number;
  firstGrade11PhaseId: number;
  firstGrade12PhaseId: number;
  activeGrade11PhaseId: number;
  activeGrade12PhaseId: number;
};

let fixture: Fixture;

test.describe("Holistic Mentorship release workflows", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const pool = getTestPool();
    try {
      const result = await pool.query<{
        school_code: string;
        draft_student_id: string;
        unassigned_student_id: string;
        former_student_id: string;
        profile_grade_11_student_id: string;
        historical_grade_12_student_id: string;
        first_grade_11_phase_id: string;
        first_grade_12_phase_id: string;
        grade_11_phase_id: string;
        grade_12_phase_id: string;
      }>(
        `SELECT school.code AS school_code,
                (SELECT notes.student_id FROM holistic_mentorship_post_session_notes notes
                 WHERE notes.state = 'draft' LIMIT 1) AS draft_student_id,
                (SELECT student.id FROM "group" school_group
                 JOIN group_user school_member ON school_member.group_id = school_group.id
                 JOIN student ON student.user_id = school_member.user_id
                 JOIN enrollment_record grade_enrollment ON grade_enrollment.user_id = student.user_id
                   AND grade_enrollment.group_type = 'grade' AND grade_enrollment.academic_year = '2026-2027'
                   AND grade_enrollment.is_current IS TRUE
                 JOIN grade ON grade.id = grade_enrollment.group_id AND grade.number = 11
                 JOIN LATERAL (
                   SELECT batch.program_id FROM enrollment_record batch_enrollment
                   JOIN "group" batch_group ON batch_group.id = batch_enrollment.group_id AND batch_group.type = 'batch'
                   JOIN batch ON batch.id = batch_group.child_id
                   WHERE batch_enrollment.user_id = student.user_id
                     AND batch_enrollment.group_type = 'batch' AND batch_enrollment.is_current IS TRUE
                   ORDER BY array_position(ARRAY[1, 2, 64]::int[], batch.program_id), batch_enrollment.id LIMIT 1
                 ) roster_program ON roster_program.program_id = 1
                 WHERE school_group.type = 'school' AND school_group.child_id = centre.school_id AND NOT EXISTS (
                     SELECT 1 FROM holistic_mentorship_mentor_mentee_mappings mapping
                     WHERE mapping.student_id = student.id AND mapping.academic_year = '2026-2027' AND mapping.ended_at IS NULL)
                 ORDER BY student.id LIMIT 1) AS unassigned_student_id,
                (SELECT mapping.student_id FROM holistic_mentorship_mentor_mentee_mappings mapping
                 WHERE mapping.end_reason = 'synthetic_access_loss' LIMIT 1) AS former_student_id,
                (SELECT journey.student_id FROM holistic_mentorship_profile_journeys journey
                 JOIN holistic_mentorship_mentor_mentee_mappings mapping ON mapping.student_id = journey.student_id
                   AND mapping.academic_year = '2026-2027' AND mapping.ended_at IS NULL
                 WHERE journey.entry_grade = 11 ORDER BY journey.student_id LIMIT 1) AS profile_grade_11_student_id,
                (SELECT notes.student_id FROM holistic_mentorship_historical_notes notes
                 JOIN holistic_mentorship_mentor_mentee_mappings mapping ON mapping.student_id = notes.student_id
                   AND mapping.academic_year = '2026-2027' AND mapping.ended_at IS NULL
                 ORDER BY notes.student_id LIMIT 1) AS historical_grade_12_student_id,
                (SELECT phase.id FROM holistic_mentorship_phases phase
                 JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
                 JOIN grade ON grade.id = phase.grade_id
                 WHERE plan.academic_year = '2026-2027' AND plan.program_id = 1
                   AND grade.number = 11 AND phase.state = 'open' ORDER BY phase.position LIMIT 1) AS first_grade_11_phase_id,
                (SELECT phase.id FROM holistic_mentorship_phases phase
                 JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
                 JOIN grade ON grade.id = phase.grade_id
                 WHERE plan.academic_year = '2026-2027' AND plan.program_id = 1
                   AND grade.number = 12 AND phase.state = 'open' ORDER BY phase.position LIMIT 1) AS first_grade_12_phase_id,
                (SELECT phase.id FROM holistic_mentorship_phases phase
                 JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
                 JOIN grade ON grade.id = phase.grade_id
                 WHERE plan.academic_year = '2026-2027' AND plan.program_id = 1
                   AND grade.number = 11 AND phase.state = 'open' ORDER BY phase.position DESC LIMIT 1) AS grade_11_phase_id,
                (SELECT phase.id FROM holistic_mentorship_phases phase
                 JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
                 JOIN grade ON grade.id = phase.grade_id
                 WHERE plan.academic_year = '2026-2027' AND plan.program_id = 1
                   AND grade.number = 12 AND phase.state = 'open' ORDER BY phase.position DESC LIMIT 1) AS grade_12_phase_id
         FROM user_permission fixture_permission
         JOIN school ON school.code = fixture_permission.school_codes[1]
         JOIN centres centre ON centre.school_id = school.id
         WHERE LOWER(fixture_permission.email) = 'e2e-holistic-teacher@test.local'
           AND centre.program_id = 1 AND centre.is_active IS TRUE
           AND EXISTS (SELECT 1 FROM holistic_mentorship_phases phase
             JOIN holistic_mentorship_phase_plans plan ON plan.id = phase.phase_plan_id
             WHERE plan.program_id = 1 AND plan.academic_year = '2026-2027')
         ORDER BY centre.school_id LIMIT 1`
      );
      const row = result.rows[0];
      fixture = {
        schoolCode: row.school_code,
        draftStudentId: Number(row.draft_student_id),
        unassignedStudentId: Number(row.unassigned_student_id),
        formerStudentId: Number(row.former_student_id),
        profileGrade11StudentId: Number(row.profile_grade_11_student_id),
        historicalGrade12StudentId: Number(row.historical_grade_12_student_id),
        firstGrade11PhaseId: Number(row.first_grade_11_phase_id),
        firstGrade12PhaseId: Number(row.first_grade_12_phase_id),
        activeGrade11PhaseId: Number(row.grade_11_phase_id),
        activeGrade12PhaseId: Number(row.grade_12_phase_id),
      };
    } finally {
      await pool.end();
    }
  });

  test("Profile and Context sources follow the approved precedence", async ({
    holisticTeacherPage,
  }) => {
    await holisticTeacherPage.goto(studentPhaseUrl(
      fixture.profileGrade11StudentId,
      fixture.firstGrade11PhaseId
    ));
    await expect(holisticTeacherPage.getByText("Student Profile", { exact: true })).toBeVisible();
    for (const position of [1, 2, 3, 4, 5]) {
      await expect(holisticTeacherPage.getByText(`Synthetic Question Set ${position}`, { exact: true })).toBeVisible();
      await expect(holisticTeacherPage.getByText(`Synthetic summary ${position}.`, { exact: true })).toBeVisible();
    }

    await holisticTeacherPage.goto(studentPhaseUrl(
      fixture.profileGrade11StudentId,
      fixture.activeGrade11PhaseId
    ));
    await expect(holisticTeacherPage.getByText(
      "From Phase 1 - Synthetic Grade 11 Completed",
      { exact: true }
    )).toBeVisible();
    await expect(holisticTeacherPage.getByText("Synthetic mentoring note.", { exact: true })).toBeVisible();
    await expect(holisticTeacherPage.getByText(/^Last updated /)).toBeVisible();
    await expect(holisticTeacherPage.getByText("Synthetic Holistic Teacher", { exact: true })).toHaveCount(0);

    await holisticTeacherPage.goto(studentPhaseUrl(
      fixture.historicalGrade12StudentId,
      fixture.firstGrade12PhaseId
    ));
    await expect(holisticTeacherPage.getByText("Historical notes", { exact: true })).toBeVisible();
    for (const position of [1, 2, 3, 4]) {
      await expect(holisticTeacherPage.getByText(
        `Synthetic historical question ${position}?`,
        { exact: true }
      )).toBeVisible();
    }
    await expect(holisticTeacherPage.getByText("No response recorded", { exact: true })).toBeVisible();
  });

  test("eligible Teacher assigns a Student, submits Notes, and edits the official Notes", async ({
    holisticTeacherPage,
  }) => {
    for (const width of [1280, 375]) {
      await holisticTeacherPage.setViewportSize({ width, height: 800 });
      await openTeacherWorkspace(holisticTeacherPage);
      await expectNoPageOverflow(holisticTeacherPage);
    }
    await holisticTeacherPage.setViewportSize({ width: 1280, height: 800 });
    await openTeacherWorkspace(holisticTeacherPage);
    const unassigned = holisticTeacherPage.locator(`input[aria-label^="Select "]:not(:disabled)`).first();
    await expect(unassigned).toBeVisible();
    await unassigned.check();
    const assignment = holisticTeacherPage.waitForResponse((response) =>
      response.url().endsWith("/api/holistic-mentorship/mappings") && response.request().method() === "POST"
    );
    holisticTeacherPage.once("dialog", (dialog) => dialog.accept());
    await holisticTeacherPage.getByRole("button", { name: "Assign 1 selected" }).click();
    await expect((await assignment).status()).toBe(200);

    await holisticTeacherPage.goto(studentPhaseUrl(fixture.draftStudentId, fixture.activeGrade11PhaseId));
    const notes = holisticTeacherPage.getByLabel("What support will help next?");
    await expect(notes).toBeVisible();
    const autosave = holisticTeacherPage.waitForResponse((response) =>
      response.url().includes(`/students/${fixture.draftStudentId}/phases/`) &&
      response.request().method() === "PATCH" && response.request().postData()?.includes('"action":"draft"') === true
    );
    await notes.fill("Synthetic submitted answer from the release workflow.");
    await expect((await autosave).status()).toBe(200);
    await holisticTeacherPage.reload();
    await expect(notes).toHaveValue("Synthetic submitted answer from the release workflow.");

    holisticTeacherPage.once("dialog", (dialog) => dialog.accept());
    const submit = holisticTeacherPage.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.request().postData()?.includes('"action":"submit"') === true
    );
    await holisticTeacherPage.getByRole("button", { name: "Submit Notes" }).click();
    await expect((await submit).status()).toBe(200);
    await expect(holisticTeacherPage.getByText("Notes submitted. Phase completed.")).toBeVisible();
    await expect(holisticTeacherPage.getByRole("tab", { name: / - Completed$/ })).toBeVisible();
    await expect(holisticTeacherPage.getByText(/Submitted by Synthetic teacher on/)).toBeVisible();

    await holisticTeacherPage.getByRole("button", { name: "Edit Notes" }).click();
    await notes.fill("Synthetic corrected official answer.");
    const correction = holisticTeacherPage.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.request().postData()?.includes('"action":"edit"') === true
    );
    holisticTeacherPage.once("dialog", (dialog) => dialog.accept());
    await holisticTeacherPage.getByRole("button", { name: "Save Changes" }).click();
    await expect((await correction).status()).toBe(200);
    await expect(holisticTeacherPage.getByText("Submitted Notes updated.")).toBeVisible();
  });

  test("Holistic Admin verifies progress, CSV, read-only drill-down, Phase setup, and regeneration", async ({
    holisticAdminPage,
  }) => {
    for (const width of [1280, 375]) {
      await holisticAdminPage.setViewportSize({ width, height: 800 });
      await holisticAdminPage.goto("/admin/holistic-mentorship");
      await expect(holisticAdminPage.getByRole("heading", { name: "Holistic Mentorship" })).toBeVisible();
      await expect(holisticAdminPage.getByLabel("Student progress results").locator("tbody tr").first()).toBeVisible();
      await holisticAdminPage.getByRole("tab", { name: "Phase Setup" }).click();
      await expect(holisticAdminPage.getByText("Synthetic Grade 11 Active")).toBeVisible();
      await expectNoPageOverflow(holisticAdminPage);
    }
    await holisticAdminPage.setViewportSize({ width: 1280, height: 800 });
    await holisticAdminPage.goto("/admin/holistic-mentorship");

    const program = holisticAdminPage.getByLabel("Program");
    await expect(program).toBeDisabled();
    await expect(program).toHaveValue("1");
    await expect(holisticAdminPage.getByRole("columnheader", { name: "Availability" })).toBeVisible();
    await expect(holisticAdminPage.getByRole("columnheader", { name: "Completed on" })).toBeVisible();

    const progress = await holisticAdminPage.request.get(
      "/api/holistic-mentorship/progress?academic_year=2026-2027&page=1&sort=school&direction=asc"
    );
    expect(progress.status()).toBe(200);
    const progressBody = await progress.json();
    expect(progressBody.rows.some((row: { studentId: number }) => row.studentId === fixture.unassignedStudentId)).toBe(false);
    const draftRow = progressBody.rows.find((row: { studentId: number }) => row.studentId === fixture.draftStudentId);
    expect(draftRow).toMatchObject({ progress: "pending", phaseState: "active", answers: [] });

    const csv = await holisticAdminPage.request.get(
      "/api/holistic-mentorship/progress?academic_year=2026-2027&page=1&sort=student_name&direction=asc&format=csv"
    );
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const csvBody = await csv.text();
    expect(csvBody).toContain("Academic Year,Program ID,Program Name");
    expect(csvBody).toContain("Notes Author Name,Notes Author Email,Notes Last Edited At");
    expect(csvBody).not.toMatch(/Student Profile|Student Context|profile_journey_id|mapping_id/i);

    await holisticAdminPage.getByRole("link", { name: /^Open / }).first().click();
    await expect(holisticAdminPage.getByText("Read-only", { exact: true })).toBeVisible();
    await holisticAdminPage.goto("/admin/holistic-mentorship");
    await holisticAdminPage.getByRole("tab", { name: "Phase Setup" }).click();
    await expect(holisticAdminPage.getByText("Synthetic Grade 11 Active")).toBeVisible();
    await expect(holisticAdminPage.getByText("Open · Active", { exact: true }).first()).toBeVisible();
    await holisticAdminPage.getByText("Synthetic Grade 11 Locked", { exact: true }).click();
    holisticAdminPage.once("dialog", (dialog) => dialog.accept());
    const phaseOpen = holisticAdminPage.waitForResponse((response) =>
      response.url().endsWith("/api/holistic-mentorship/phase-plans") &&
      response.request().method() === "PATCH" && response.request().postData()?.includes('"action":"state"') === true
    );
    await holisticAdminPage.getByRole("button", { name: "Open Phase" }).click();
    await expect((await phaseOpen).status()).toBe(200);
    const openedPhase = holisticAdminPage.getByText("Synthetic Grade 11 Locked", { exact: true }).locator("..").locator("..");
    await expect(openedPhase.getByText("Open · Active", { exact: true })).toBeVisible();

    await holisticAdminPage.getByRole("tab", { name: "Students & Progress" }).click();
    await holisticAdminPage.route("**/api/holistic-mentorship/profiles/*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "queued" }) });
      } else {
        await route.continue();
      }
    });
    await holisticAdminPage.getByRole("button", { name: /^Profile for / }).first().click();
    holisticAdminPage.once("dialog", (dialog) => dialog.accept());
    await holisticAdminPage.getByRole("button", { name: "Regenerate Profile" }).click();
    await expect(holisticAdminPage.getByRole("status")).toHaveText("Regeneration queued.");
  });

  test("global Admin and Holistic Admin have distinct role and deletion gates", async ({
    adminPage,
    holisticAdminPage,
  }) => {
    const adminDeletion = await apiStatus(adminPage,
      `/api/holistic-mentorship/privacy-deletions/${fixture.draftStudentId}`, "POST", {});
    expect(adminDeletion).toBe(422);
    const scopedDeletion = await apiStatus(holisticAdminPage,
      `/api/holistic-mentorship/privacy-deletions/${fixture.draftStudentId}`, "POST", {});
    expect(scopedDeletion).toBe(403);
    const adminRole = await apiStatus(adminPage, "/api/admin/users", "POST", {});
    expect(adminRole).not.toBe(403);
    const scopedRole = await apiStatus(holisticAdminPage, "/api/admin/users", "POST", {});
    expect(scopedRole).toBe(403);
  });

  test("former Mentor loses stale-link access and excluded roles receive server-side 403 on desktop and mobile", async ({
    formerMentorPage,
    pmPage,
    programAdminPage,
    passcodePage,
  }) => {
    const stale = await formerMentorPage.request.get(
      `/api/holistic-mentorship/students/${fixture.formerStudentId}/phases/${fixture.activeGrade12PhaseId}` +
      `?school_code=${fixture.schoolCode}&academic_year=2026-2027`
    );
    expect(stale.status()).toBe(404);

    for (const page of [pmPage, programAdminPage, passcodePage]) {
      const desktopResponse = await page.request.get(
        "/api/holistic-mentorship/progress?academic_year=2026-2027"
      );
      expect(desktopResponse.status()).toBe(403);
      await page.setViewportSize({ width: 375, height: 800 });
      const mobileResponse = await page.request.get(
        "/api/holistic-mentorship/progress?academic_year=2026-2027"
      );
      expect(mobileResponse.status()).toBe(403);
      await page.goto("/admin/holistic-mentorship");
      await expect(page.getByRole("heading", { name: "Holistic Mentorship" })).not.toBeVisible();
    }

    await pmPage.goto("/admin/holistic-mentorship");
    await expectNoPageOverflow(pmPage);
  });
});

async function openTeacherWorkspace(page: Page) {
  await page.goto(`/school/${fixture.schoolCode}`);
  const tab = page.getByRole("button", { name: "Holistic Mentorship", exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.getByRole("tab", { name: "Assign Students" })).toBeVisible();
}

function studentPhaseUrl(studentId: number, phaseId: number) {
  return `/holistic-mentorship/students/${studentId}/phases/${phaseId}` +
    `?school_code=${fixture.schoolCode}&academic_year=2026-2027`;
}

async function apiStatus(page: Page, url: string, method: string, body: unknown) {
  return (await page.request.fetch(url, { method, data: body })).status();
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
}
