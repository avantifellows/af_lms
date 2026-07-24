import type { Page, TestInfo } from "@playwright/test";

import { expect, test } from "../fixtures/auth";
import { getTestPool } from "../helpers/db";

type Fixture = {
  schoolCode: string;
  draftStudentId: number;
  unassignedStudentId: number;
  unassignedStudentExternalId: string;
  formerStudentId: number;
  profileGrade11StudentId: number;
  historicalGrade12StudentId: number;
  firstGrade11PhaseId: number;
  firstGrade12PhaseId: number;
  activeGrade11PhaseId: number;
  activeGrade12PhaseId: number;
};

let fixture: Fixture;

const RESPONSIVE_VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone-portrait", width: 375, height: 812 },
  { name: "phone-landscape", width: 812, height: 375 },
] as const;

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
      const unassignedStudent = await pool.query<{ student_id: string }>(
        "SELECT student_id FROM student WHERE id = $1",
        [row.unassigned_student_id]
      );
      fixture = {
        schoolCode: row.school_code,
        draftStudentId: Number(row.draft_student_id),
        unassignedStudentId: Number(row.unassigned_student_id),
        unassignedStudentExternalId: unassignedStudent.rows[0].student_id,
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

  test("Mentor and Admin workflows remain responsive, keyboard usable, and free of browser errors", async ({
    holisticTeacherPage,
    holisticAdminPage,
  }, testInfo) => {
    test.setTimeout(60_000);
    const teacherHealth = collectBrowserHealth(holisticTeacherPage);
    const adminHealth = collectBrowserHealth(holisticAdminPage);

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await holisticTeacherPage.setViewportSize(viewport);
      await openTeacherWorkspace(holisticTeacherPage);

      await expect(
        holisticTeacherPage.getByRole("heading", { name: "Holistic Mentorship" })
      ).toBeVisible();
      await expect(
        holisticTeacherPage.getByRole("heading", { name: "My Mentees" })
      ).toBeVisible();
      await expect(holisticTeacherPage.getByRole("textbox", { name: "Search Students" })).toBeVisible();
      await expect(holisticTeacherPage.getByRole("combobox", { name: "Filter by Grade" })).toBeVisible();
      await expect(holisticTeacherPage.getByRole("combobox", { name: "Filter by Assignment" })).toBeVisible();
      await expect(holisticTeacherPage.getByRole("table", { name: "Student assignment results" })).toBeVisible();
      await expectContainedHorizontalScroll(
        holisticTeacherPage.getByRole("table", { name: "Student assignment results" })
      );
      await expectNoPageOverflow(holisticTeacherPage);
      await expectMinimumTapTarget(assignmentSummary(holisticTeacherPage));
      await captureResponsiveScreenshot(holisticTeacherPage, testInfo, `mentor-assignment-${viewport.name}`);
    }

    await holisticTeacherPage.setViewportSize(RESPONSIVE_VIEWPORTS[0]);
    await openTeacherWorkspace(holisticTeacherPage);
    await expect(holisticTeacherPage.getByRole("button", { name: /^Remove / }).first()).toBeVisible();
    const summary = assignmentSummary(holisticTeacherPage);
    const searchStudents = holisticTeacherPage.getByRole("textbox", { name: "Search Students" });
    await summary.focus();
    await summary.press("Enter");
    await expect(searchStudents).toBeHidden();
    await summary.press("Enter");
    await expect(searchStudents).toBeVisible();

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await holisticTeacherPage.setViewportSize(viewport);
      await holisticTeacherPage.goto(studentPhaseUrl(
        fixture.profileGrade11StudentId,
        fixture.firstGrade11PhaseId
      ));
      const phaseTabs = holisticTeacherPage.getByRole("tablist", { name: "Holistic Phases" });
      await expect(phaseTabs).toBeVisible();
      await expect(phaseTabs.getByRole("tab", { selected: true })).toBeVisible();
      await expect(holisticTeacherPage.getByRole("heading", { name: "Student Context" })).toBeVisible();
      await expect(holisticTeacherPage.getByRole("heading", { name: "Post-Session Notes" })).toBeVisible();
      await expectNoPageOverflow(holisticTeacherPage);
      await captureResponsiveScreenshot(holisticTeacherPage, testInfo, `mentor-phase-${viewport.name}`);
    }

    await holisticTeacherPage.setViewportSize(RESPONSIVE_VIEWPORTS[0]);
    const phaseTabs = holisticTeacherPage.getByRole("tablist", { name: "Holistic Phases" });
    const selectedPhase = phaseTabs.getByRole("tab", { selected: true });
    const enabledPhases = phaseTabs.locator('[role="tab"]:not([aria-disabled="true"])');
    const lastEnabledPhase = enabledPhases.last();
    const firstEnabledPhase = enabledPhases.first();
    await selectedPhase.focus();
    await selectedPhase.press("End");
    await expect(lastEnabledPhase).toBeFocused();
    await expect(lastEnabledPhase).toHaveAttribute("aria-selected", "true");
    await lastEnabledPhase.press("Home");
    await expect(firstEnabledPhase).toBeFocused();
    await expect(firstEnabledPhase).toHaveAttribute("aria-selected", "true");

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await holisticAdminPage.setViewportSize(viewport);
      await openAdminProgress(holisticAdminPage);
      const adminSections = holisticAdminPage.getByRole("tablist", {
        name: "Holistic Mentorship sections",
      });
      await expect(adminSections).toBeVisible();
      await expect(adminSections.getByRole("tab", { name: "Students & Progress" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      await expect(holisticAdminPage.getByRole("combobox", { name: "Program" })).toBeVisible();
      await expect(holisticAdminPage.getByRole("combobox", { name: "Academic Year" })).toBeVisible();
      await expect(holisticAdminPage.getByRole("combobox", { name: "Phase lens" })).toBeVisible();
      await expect(holisticAdminPage.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(holisticAdminPage.getByRole("button", { name: "Export CSV" })).toBeVisible();
      const progressTable = holisticAdminPage.getByRole("table", { name: "Student progress results" });
      await expect(progressTable).toBeVisible();
      await expect(progressTable).toHaveAttribute("aria-busy", "false");
      await expectContainedHorizontalScroll(progressTable);
      await captureResponsiveScreenshot(holisticAdminPage, testInfo, `admin-progress-${viewport.name}`);
      await expectNoPageOverflow(holisticAdminPage);
      await expectMinimumTapTarget(holisticAdminPage.getByRole("button", { name: "Refresh" }));
      await expectMinimumTapTarget(holisticAdminPage.getByRole("button", { name: "Export CSV" }));
    }

    await holisticAdminPage.setViewportSize(RESPONSIVE_VIEWPORTS[0]);
    await openAdminProgress(holisticAdminPage);
    const adminSections = holisticAdminPage.getByRole("tablist", {
      name: "Holistic Mentorship sections",
    });
    const progressTab = adminSections.getByRole("tab", { name: "Students & Progress" });
    const phaseSetupTab = adminSections.getByRole("tab", { name: "Phase Setup" });
    await progressTab.focus();
    await progressTab.press("End");
    await expect(phaseSetupTab).toBeFocused();
    await expect(phaseSetupTab).toHaveAttribute("aria-selected", "true");
    await phaseSetupTab.press("Home");
    await expect(progressTab).toBeFocused();
    await expect(progressTab).toHaveAttribute("aria-selected", "true");

    const openStudent = holisticAdminPage.getByRole("link", { name: /^Open / }).first();
    await openStudent.focus();
    await expect(openStudent).toBeFocused();
    await openStudent.press("Enter");
    await expect(holisticAdminPage.getByText("Admin read-only view", { exact: true })).toBeVisible();
    const backToProgress = holisticAdminPage.getByRole("link", { name: "Back to Students and Progress" });
    await backToProgress.focus();
    await expect(backToProgress).toBeFocused();
    await backToProgress.press("Enter");
    await expect(holisticAdminPage).toHaveURL("/admin/holistic-mentorship");

    await holisticAdminPage.setViewportSize(RESPONSIVE_VIEWPORTS[1]);
    await phaseSetupTab.click();
    await expect(holisticAdminPage.getByRole("region", { name: "Phase Setup" })).toBeVisible();
    await holisticAdminPage.getByText("Synthetic Grade 11 Active", { exact: true }).click();
    const guidanceSwitch = holisticAdminPage.getByRole("group", { name: "Guidance view" });
    await expect(guidanceSwitch).toBeVisible();
    const previewButton = guidanceSwitch.getByRole("button", { name: "Preview" });
    await previewButton.click();
    await expect(previewButton).toHaveAttribute("aria-pressed", "true");
    await expectMinimumTapTarget(previewButton);
    await expectNoPageOverflow(holisticAdminPage);
    await captureResponsiveScreenshot(holisticAdminPage, testInfo, "admin-phase-setup-phone-portrait");

    expectBrowserHealth(teacherHealth);
    expectBrowserHealth(adminHealth);
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
    await holisticTeacherPage.getByRole("textbox", { name: "Search Students" })
      .fill(fixture.unassignedStudentExternalId);
    const unassigned = holisticTeacherPage.locator(`input[aria-label^="Select "]:not(:disabled)`).first();
    await expect(unassigned).toBeVisible();
    await unassigned.check();
    const assignment = holisticTeacherPage.waitForResponse((response) =>
      response.url().endsWith("/api/holistic-mentorship/mappings") && response.request().method() === "POST"
    );
    holisticTeacherPage.once("dialog", (dialog) => dialog.accept());
    await holisticTeacherPage.getByRole("button", { name: "Assign to me (1)" }).click();
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
    await expect(holisticAdminPage.getByRole("columnheader", { name: "Phase" })).toBeVisible();
    await expect(holisticAdminPage.getByRole("columnheader", { name: "Completed on" })).toBeVisible();

    const progress = await holisticAdminPage.request.get(
      "/api/holistic-mentorship/progress?academic_year=2026-2027&page=1&sort=school&direction=asc"
    );
    expect(progress.status()).toBe(200);
    const progressBody = await progress.json();
    expect(progressBody.rows.some((row: { studentId: number }) => row.studentId === fixture.unassignedStudentId)).toBe(true);
    const completedProgress = await holisticAdminPage.request.get(
      "/api/holistic-mentorship/progress?academic_year=2026-2027&page=1&sort=school&direction=asc" +
      `&phase_id=${fixture.firstGrade11PhaseId}`
    );
    expect(completedProgress.status()).toBe(200);
    const completedBody = await completedProgress.json();
    const completedRow = completedBody.rows.find(
      (row: { studentId: number }) => row.studentId === fixture.profileGrade11StudentId
    );
    expect(completedRow).toMatchObject({
      phaseState: "open",
      progress: "completed",
      answers: [{
        position: 1,
        question: "Synthetic: What support will help next?",
        answer: "Synthetic mentoring note.",
      }],
    });

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
    await expect(holisticAdminPage.getByText("Admin read-only view", { exact: true })).toBeVisible();
    await holisticAdminPage.goto("/admin/holistic-mentorship");
    await holisticAdminPage.getByRole("tab", { name: "Phase Setup" }).click();
    await expect(holisticAdminPage.getByText("Synthetic Grade 11 Active")).toBeVisible();
    await expect(holisticAdminPage.getByText("Active", { exact: true }).first()).toBeVisible();
    await holisticAdminPage.getByText("Synthetic Grade 11 Locked", { exact: true }).click();
    holisticAdminPage.once("dialog", (dialog) => dialog.accept());
    const phaseOpen = holisticAdminPage.waitForResponse((response) =>
      response.url().endsWith("/api/holistic-mentorship/phase-plans") &&
      response.request().method() === "PATCH" && response.request().postData()?.includes('"action":"state"') === true
    );
    await holisticAdminPage.getByRole("button", { name: "Open Phase" }).click();
    await expect((await phaseOpen).status()).toBe(200);
    const openedPhase = holisticAdminPage.getByText("Synthetic Grade 11 Locked", { exact: true }).locator("..").locator("..");
    await expect(openedPhase.getByText("Active", { exact: true })).toBeVisible();

    await holisticAdminPage.getByRole("tab", { name: "Students & Progress" }).click();
    await holisticAdminPage.route("**/api/holistic-mentorship/profiles/*", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ state: "queued" }) });
      } else {
        await route.continue();
      }
    });
    await holisticAdminPage.goto(studentPhaseUrl(
      fixture.profileGrade11StudentId,
      fixture.firstGrade11PhaseId
    ));
    await expect(holisticAdminPage.getByText("Student Profile context", { exact: true })).toBeVisible();
    holisticAdminPage.once("dialog", (dialog) => dialog.accept());
    await holisticAdminPage.getByRole("button", { name: "Request Profile regeneration" }).click();
    await expect(holisticAdminPage.getByText("Regeneration queued.", { exact: true })).toBeVisible();
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

function assignmentSummary(page: Page) {
  return page.locator("summary").filter({ hasText: "Assign Students" });
}

async function openTeacherWorkspace(page: Page) {
  await page.goto(`/school/${fixture.schoolCode}`);
  const tab = page.getByRole("tab", { name: "Holistic Mentorship", exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  const summary = assignmentSummary(page);
  await expect(summary).toBeVisible();
  const searchStudents = page.getByRole("textbox", { name: "Search Students" });
  if (!(await searchStudents.isVisible())) await summary.click();
  await expect(searchStudents).toBeVisible();
}

async function openAdminProgress(page: Page) {
  await page.goto("/admin/holistic-mentorship");
  await expect(page.getByRole("heading", { name: "Holistic Mentorship" })).toBeVisible();
  const progressTab = page.getByRole("tab", { name: "Students & Progress" });
  await expect(progressTab).toBeVisible();
  if (await progressTab.getAttribute("aria-selected") !== "true") await progressTab.click();
  await expect(page.getByRole("table", { name: "Student progress results" })).toBeVisible();
}

function studentPhaseUrl(studentId: number, phaseId: number) {
  return `/holistic-mentorship/students/${studentId}/phases/${phaseId}` +
    `?school_code=${fixture.schoolCode}&academic_year=2026-2027`;
}

async function apiStatus(page: Page, url: string, method: string, body: unknown) {
  return (await page.request.fetch(url, { method, data: body })).status();
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const original = { x: window.scrollX, y: window.scrollY };
    window.scrollTo(document.documentElement.scrollWidth, original.y);
    const horizontalPageScroll = window.scrollX;
    window.scrollTo(original.x, original.y);
    return {
      horizontalPageScroll,
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: element.className,
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
            width: Math.round(bounds.width),
          };
        })
        .filter(({ left, right }) => left < -1 || right > document.documentElement.clientWidth + 1)
        .slice(0, 12),
    };
  });
  expect(overflow.horizontalPageScroll,
    `page scrolled ${overflow.horizontalPageScroll}px horizontally (document ${overflow.document}px, viewport ${overflow.viewport}px); offenders: ${JSON.stringify(overflow.offenders)}`)
    .toBeLessThanOrEqual(1);
}

async function expectContainedHorizontalScroll(table: ReturnType<Page["getByRole"]>) {
  const result = await table.evaluate((element) => {
    const container = element.parentElement;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      viewport: document.documentElement.clientWidth,
      scrollable: container.scrollWidth > container.clientWidth,
    };
  });
  expect(result).not.toBeNull();
  expect(result!.left).toBeGreaterThanOrEqual(-1);
  expect(result!.right).toBeLessThanOrEqual(result!.viewport + 1);
  if (result!.viewport < 640) expect(result!.scrollable).toBe(true);
}

async function expectMinimumTapTarget(locator: ReturnType<Page["getByRole"]>) {
  const box = await locator.boundingBox();
  expect(box, "expected a visible tap target").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function captureResponsiveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

type BrowserHealth = {
  consoleErrors: string[];
  pageErrors: string[];
  networkErrors: string[];
};

function collectBrowserHealth(page: Page): BrowserHealth {
  const health: BrowserHealth = { consoleErrors: [], pageErrors: [], networkErrors: [] };
  page.on("console", (message) => {
    if (message.type() === "error") health.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => health.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!request.url().includes("/api/holistic-mentorship/")) return;
    const failure = request.failure()?.errorText ?? "request failed";
    if (failure.includes("ERR_ABORTED")) return;
    health.networkErrors.push(`${request.method()} ${request.url()} - ${failure}`);
  });
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
