import { test, expect } from "../fixtures/auth";
import {
  buildCompleteAFTeamInteractionData,
  buildCompleteClassroomObservationData,
  buildCompleteGroupStudentDiscussionData,
  buildCompleteIndividualStudentDiscussionData,
  buildCompleteIndividualTeacherInteractionData,
  buildCompletePrincipalInteractionData,
  getTestPool,
  seedIndividualTeacherTestTeachers,
  seedTestVisit,
  seedVisitAction,
} from "../helpers/db";
import { AF_TEAM_INTERACTION_CONFIG } from "../../src/lib/af-team-interaction";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "../../src/lib/group-student-discussion";
import { INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG } from "../../src/lib/individual-af-teacher-interaction";
import { INDIVIDUAL_STUDENT_DISCUSSION_CONFIG } from "../../src/lib/individual-student-discussion";
import type { Page } from "@playwright/test";
import type { Pool } from "pg";

let pool: Pool;
let schoolCode: string;
let seededTeachers: { id: number; name: string }[];

async function setGoodGps(page: Page) {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({
    latitude: 23.0225,
    longitude: 72.5714,
    accuracy: 50,
  });
}

async function fillClassroomRubricScores(page: Page) {
  // Select teacher and grade (required before rubric is visible)
  const teacherSelect = page.getByTestId("teacher-select");
  await expect(teacherSelect).toBeVisible();
  const teacherOptions = teacherSelect.locator("option:not([disabled])");
  await expect(teacherOptions.first()).toBeAttached();
  await teacherSelect.selectOption({ index: 1 });

  const gradeSelect = page.getByTestId("grade-select");
  await expect(gradeSelect).toBeVisible();
  await gradeSelect.selectOption("10");

  const rubricCards = page.locator('[data-testid^="rubric-param-"]');
  await expect(rubricCards).toHaveCount(19);

  const count = await rubricCards.count();
  for (let index = 0; index < count; index += 1) {
    await rubricCards.nth(index).locator('input[type="radio"]').first().check();
  }

  await expect(page.getByTestId("rubric-answered-summary")).toHaveText("Answered: 19/19");
}

async function fillAFTeamInteractionForm(page: Page) {
  await page.getByTestId("af-team-select-all").click();
  for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
    await page.getByTestId(`af-team-${key}-yes`).check();
  }
  await expect(page.getByTestId("af-team-progress")).toContainText("Answered: 9/9");
}

async function fillIndividualTeacherInteractionForm(page: Page) {
  // Wait for teacher list to load
  const addSelect = page.getByTestId("add-teacher-select");
  await expect(addSelect).toBeVisible();

  // Select the first available teacher from the dropdown
  const options = addSelect.locator("option:not([disabled])");
  await expect(options.first()).toBeAttached();
  await addSelect.selectOption({ index: 1 });

  // The new teacher section should auto-expand; attendance defaults to "present"
  const teacherSections = page.locator('[data-testid^="teacher-section-"]');
  await expect(teacherSections).toHaveCount(1);

  // Get the teacher ID from the section's data-testid
  const sectionTestId = await teacherSections.first().getAttribute("data-testid");
  const teacherId = sectionTestId!.replace("teacher-section-", "");

  // Verify attendance is "present" (default)
  const presentRadio = page.getByTestId(`teacher-${teacherId}-attendance-present`);
  await expect(presentRadio).toBeChecked();

  // Answer all 13 questions with "Yes"
  for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
    await page.getByTestId(`teacher-${teacherId}-${key}-yes`).check();
  }
}

async function fillAllIndividualTeachers(page: Page) {
  const addSelect = page.getByTestId("add-teacher-select");
  await expect(addSelect).toBeVisible();

  const options = addSelect.locator("option:not([disabled])");
  const totalTeachers = await options.count();

  for (let i = 0; i < totalTeachers; i++) {
    await page.getByTestId("add-teacher-select").selectOption({ index: 1 });

    const sections = page.locator('[data-testid^="teacher-section-"]');
    await expect(sections).toHaveCount(i + 1);

    const newest = sections.nth(i);
    const tid = (await newest.getAttribute("data-testid"))!.replace(
      "teacher-section-",
      ""
    );

    if (i === 0) {
      // First teacher: present (default), answer all 13 questions
      for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
        await page.getByTestId(`teacher-${tid}-${key}-yes`).check();
      }
    } else {
      // Remaining teachers: mark absent (no questions needed)
      await page.getByTestId(`teacher-${tid}-attendance-absent`).check();
    }
  }

  await expect(page.getByTestId("all-teachers-recorded")).toBeVisible();
}

async function fillGroupStudentDiscussionForm(page: Page) {
  // Select grade 11
  const gradeSelect = page.getByTestId("group-student-grade-select");
  await expect(gradeSelect).toBeVisible();
  await gradeSelect.selectOption("11");

  // Answer all 4 questions with Yes
  for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
    await page.getByTestId(`group-student-${key}-yes`).check();
  }

  await expect(page.getByTestId("group-student-discussion-progress")).toContainText("Answered: 4/4");
}

async function fillIndividualStudentDiscussionForm(page: Page) {
  // Select grade 11 from the grade filter
  const gradeFilter = page.getByTestId("student-grade-filter");
  await expect(gradeFilter).toBeVisible();
  await gradeFilter.selectOption("11");

  // Wait for students to load and select the first available student
  const addSelect = page.getByTestId("add-student-select");
  await expect(addSelect).toBeVisible({ timeout: 10_000 });
  const options = addSelect.locator("option:not([disabled])");
  await expect(options.first()).toBeAttached({ timeout: 10_000 });
  await addSelect.selectOption({ index: 1 });

  // The new student section should auto-expand
  const studentSections = page.locator('[data-testid^="student-section-"]');
  await expect(studentSections).toHaveCount(1);

  // Get the student ID from the section's data-testid
  const sectionTestId = await studentSections.first().getAttribute("data-testid");
  const studentId = sectionTestId!.replace("student-section-", "");

  // Answer all 2 questions with Yes
  for (const key of INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
    await page.getByTestId(`student-${studentId}-${key}-yes`).check();
  }
}

test.beforeAll(async () => {
  pool = getTestPool();

  const schoolResult = await pool.query(
    `SELECT code FROM school WHERE region = 'AHMEDABAD' LIMIT 1`
  );
  if (schoolResult.rows.length > 0) {
    schoolCode = schoolResult.rows[0].code as string;
  } else {
    schoolCode = "E2EAHM001";
    await pool.query(
      `INSERT INTO school (code, name, region, inserted_at, updated_at)
       SELECT $1::varchar, 'E2E Test School Ahmedabad', 'AHMEDABAD', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM school WHERE code = $1::varchar)`,
      [schoolCode]
    );
  }

  // Seed teachers for AF team interaction tests
  await pool.query(
    `INSERT INTO user_permission (email, level, role, school_codes, full_name, read_only)
     VALUES ('e2e-af-teacher-1@test.local', 1, 'teacher', ARRAY[$1::TEXT], 'AF Test Teacher One', false)
     ON CONFLICT (email) DO UPDATE SET school_codes = ARRAY[$1::TEXT], full_name = 'AF Test Teacher One'`,
    [schoolCode]
  );
  await pool.query(
    `INSERT INTO user_permission (email, level, role, school_codes, full_name, read_only)
     VALUES ('e2e-af-teacher-2@test.local', 1, 'teacher', ARRAY[$1::TEXT], 'AF Test Teacher Two', false)
     ON CONFLICT (email) DO UPDATE SET school_codes = ARRAY[$1::TEXT], full_name = 'AF Test Teacher Two'`,
    [schoolCode]
  );

  // Seed individual teacher test teachers (3 deterministic teachers)
  seededTeachers = await seedIndividualTeacherTestTeachers(pool, schoolCode);
});

test.afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

test.describe("Visits — Phase 6.3 E2E scenarios", () => {
  test("visits-list-shows-two-states", async ({ pmPage }) => {
    const inProgressVisit = await seedTestVisit(pool, schoolCode);
    const completedVisit = await seedTestVisit(pool, schoolCode);

    await pool.query(
      `UPDATE lms_pm_school_visits
       SET status = 'completed',
           completed_at = (NOW() AT TIME ZONE 'UTC'),
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1`,
      [completedVisit.visitId]
    );

    await pmPage.goto("/visits");

    await expect(pmPage.getByRole("heading", { name: "In Progress" })).toBeVisible();
    await expect(pmPage.getByRole("heading", { name: "Completed" })).toBeVisible();
    await expect(pmPage.getByRole("columnheader", { name: "Ended" })).toHaveCount(0);
    await expect(pmPage.getByText("Ended:")).toHaveCount(0);
    await expect(pmPage.getByRole("link", { name: "Continue" }).first()).toBeVisible();
    await expect(pmPage.getByRole("link", { name: "View" }).first()).toBeVisible();

    expect(inProgressVisit.visitId).not.toBe(completedVisit.visitId);
  });

  test("pm-can-add-and-delete-pending-action", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);

    await pmPage.getByRole("button", { name: "Add Action Point" }).click();
    const dialog = pmPage.getByRole("dialog");
    await dialog.getByLabel("AF Team Interaction").click();
    await dialog.getByRole("button", { name: "Add" }).click();

    const pendingCard = pmPage.locator('[data-action-type="af_team_interaction"]').first();
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(pendingCard.getByRole("button", { name: "Delete" })).toBeVisible();

    await pendingCard.getByRole("button", { name: "Delete" }).click();
    await expect(pmPage.locator('[data-action-type="af_team_interaction"]')).toHaveCount(0);
  });

  test("pm-can-start-and-end-classroom-observation", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "pending",
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);

    const actionCard = pmPage.getByTestId(`action-card-${actionId}`);
    await actionCard.getByRole("button", { name: "Start" }).click();
    await pmPage.waitForURL(`/visits/${visitId}/actions/${actionId}`);
    await fillClassroomRubricScores(pmPage);

    const requestOrder: string[] = [];
    pmPage.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "PATCH" &&
        url.pathname === `/api/pm/visits/${visitId}/actions/${actionId}`
      ) {
        requestOrder.push("patch");
      }
      if (
        request.method() === "POST" &&
        url.pathname === `/api/pm/visits/${visitId}/actions/${actionId}/end`
      ) {
        requestOrder.push("end");
      }
    });

    await pmPage.getByRole("button", { name: "End Action" }).click();

    await expect(
      pmPage.getByText("Completed actions are read-only for your role.")
    ).toBeVisible();
    expect(requestOrder).toEqual(["patch", "end"]);

    const actionRows = await pool.query<{ status: string; data: Record<string, unknown> }>(
      `SELECT status, data FROM lms_pm_school_visit_actions WHERE id = $1`,
      [actionId]
    );
    const actionRow = actionRows.rows[0];
    expect(actionRow?.status).toBe("completed");
    expect(typeof actionRow?.data?.rubric_version).toBe("string");
    expect(Object.keys((actionRow?.data?.params as Record<string, unknown>) ?? {})).toHaveLength(19);

    await pmPage.getByRole("link", { name: "Back to Visit" }).click();
    await pmPage.waitForURL(`/visits/${visitId}`);
    const refreshedCard = pmPage.getByTestId(`action-card-${actionId}`);
    await expect(refreshedCard.getByRole("link", { name: "View Details" })).toBeVisible();
  });

  test("classroom-end-validation-422-is-retryable", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "pending",
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);

    const actionCard = pmPage.getByTestId(`action-card-${actionId}`);
    await actionCard.getByRole("button", { name: "Start" }).click();
    await pmPage.waitForURL(`/visits/${visitId}/actions/${actionId}`);
    await pmPage.getByRole("button", { name: "End Action" }).click();

    await expect(
      pmPage.getByText("Please complete all required rubric scores before ending this observation.")
    ).toBeVisible();
    await expect(pmPage).toHaveURL(`/visits/${visitId}/actions/${actionId}`);

    await fillClassroomRubricScores(pmPage);
    await pmPage.getByRole("button", { name: "End Action" }).click();

    await expect(
      pmPage.getByText("Completed actions are read-only for your role.")
    ).toBeVisible();
  });

  test("complete-blocked-without-rubric-valid-completed-classroom-observation", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: {
        class_details: "Legacy classroom notes",
      },
    });
    await seedVisitAction(pool, visitId, {
      actionType: "leadership_meeting",
      status: "completed",
    });
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "completed",
      data: buildCompleteIndividualTeacherInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "principal_interaction",
      status: "completed",
      data: buildCompletePrincipalInteractionData(),
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);
    await pmPage.getByRole("button", { name: "Complete Visit" }).click();

    await expect(
      pmPage.getByText("At least one completed classroom observation is required to complete visit")
    ).toBeVisible();
  });

  test("complete-blocked-when-any-action-in-progress", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "leadership_meeting",
      status: "in_progress",
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);
    await pmPage.getByRole("button", { name: "Complete Visit" }).click();
    await expect(pmPage.getByRole("button", { name: "Completing..." })).toHaveCount(0, {
      timeout: 15_000,
    });

    await expect(
      pmPage.getByText("All in-progress action points must be ended before completing visit")
    ).toBeVisible();
  });

  test("complete-visit-success", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "teacher_feedback",
      status: "pending",
    });
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "completed",
      data: buildCompleteIndividualTeacherInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "principal_interaction",
      status: "completed",
      data: buildCompletePrincipalInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "group_student_discussion",
      status: "completed",
      data: buildCompleteGroupStudentDiscussionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_student_discussion",
      status: "completed",
      data: buildCompleteIndividualStudentDiscussionData(),
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);
    await pmPage.getByRole("button", { name: "Complete Visit" }).click();

    await expect(pmPage.getByText("This visit is completed and read-only.")).toBeVisible();
    await expect(pmPage.getByRole("button", { name: "Complete Visit" })).toHaveCount(0);
    await expect(pmPage.getByRole("button", { name: "Add Action Point" })).toHaveCount(0);
  });

  test("moderate-gps-warning-visible", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "leadership_meeting",
      status: "pending",
    });
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "completed",
      data: buildCompleteIndividualTeacherInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "principal_interaction",
      status: "completed",
      data: buildCompletePrincipalInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "group_student_discussion",
      status: "completed",
      data: buildCompleteGroupStudentDiscussionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_student_discussion",
      status: "completed",
      data: buildCompleteIndividualStudentDiscussionData(),
    });

    const startResponse = await pmPage.request.post(
      `/api/pm/visits/${visitId}/actions/${actionId}/start`,
      {
        data: {
          start_lat: 23.0225,
          start_lng: 72.5714,
          start_accuracy: 250,
        },
      }
    );
    expect(startResponse.ok()).toBeTruthy();
    const startPayload = await startResponse.json();
    expect(startPayload.warning).toContain("moderate");
    expect(startPayload.warning).toContain("250m");

    const endResponse = await pmPage.request.post(
      `/api/pm/visits/${visitId}/actions/${actionId}/end`,
      {
        data: {
          end_lat: 23.0225,
          end_lng: 72.5714,
          end_accuracy: 250,
        },
      }
    );
    expect(endResponse.ok()).toBeTruthy();
    const endPayload = await endResponse.json();
    expect(endPayload.warning).toContain("moderate");
    expect(endPayload.warning).toContain("250m");

    const completeResponse = await pmPage.request.post(
      `/api/pm/visits/${visitId}/complete`,
      {
        data: {
          end_lat: 23.0225,
          end_lng: 72.5714,
          end_accuracy: 250,
        },
      }
    );
    expect(completeResponse.ok()).toBeTruthy();
    const completePayload = await completeResponse.json();
    expect(completePayload.warning).toContain("moderate");
    expect(completePayload.warning).toContain("250m");
  });

  test("poor-gps-blocks-write", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "pending",
    });

    const startResponse = await pmPage.request.post(
      `/api/pm/visits/${visitId}/actions/${actionId}/start`,
      {
        data: {
          start_lat: 23.0225,
          start_lng: 72.5714,
          start_accuracy: 701,
        },
      }
    );
    expect(startResponse.status()).toBe(422);
    const startPayload = await startResponse.json();
    expect(startPayload.error).toContain("GPS accuracy too low");

    const endResponse = await pmPage.request.post(
      `/api/pm/visits/${visitId}/actions/${actionId}/end`,
      {
        data: {
          end_lat: 23.0225,
          end_lng: 72.5714,
          end_accuracy: 701,
        },
      }
    );
    expect(endResponse.status()).toBe(422);
    const endPayload = await endResponse.json();
    expect(endPayload.error).toContain("GPS accuracy too low");

    const completeResponse = await pmPage.request.post(
      `/api/pm/visits/${visitId}/complete`,
      {
        data: {
          end_lat: 23.0225,
          end_lng: 72.5714,
          end_accuracy: 701,
        },
      }
    );
    expect(completeResponse.status()).toBe(422);
    const completePayload = await completeResponse.json();
    expect(completePayload.error).toContain("GPS accuracy too low");
  });

  test("admin-can-complete-other-pm-visit-with-same-rules", async ({ adminPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "principal_interaction",
      status: "completed",
      data: buildCompletePrincipalInteractionData(),
    });

    await setGoodGps(adminPage);
    await adminPage.goto(`/visits/${visitId}`);
    await adminPage.getByRole("button", { name: "Complete Visit" }).click();

    await expect(
      adminPage.getByText("At least one completed classroom observation is required to complete visit")
    ).toBeVisible();

    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "completed",
      data: buildCompleteIndividualTeacherInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "group_student_discussion",
      status: "completed",
      data: buildCompleteGroupStudentDiscussionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_student_discussion",
      status: "completed",
      data: buildCompleteIndividualStudentDiscussionData(),
    });

    await adminPage.reload();
    await adminPage.getByRole("button", { name: "Complete Visit" }).click();
    await expect(adminPage.getByText("This visit is completed and read-only.")).toBeVisible();
  });

  test("program-admin-read-only", async ({ programAdminPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "leadership_meeting",
      status: "pending",
    });

    await programAdminPage.goto("/visits");
    await expect(
      programAdminPage.getByRole("heading", { name: "All Visits" })
    ).toBeVisible();

    await programAdminPage.goto(`/visits/${visitId}`);
    await expect(
      programAdminPage.getByText("This visit is read-only for your role.")
    ).toBeVisible();
    await expect(programAdminPage.getByRole("button", { name: "Add Action Point" })).toHaveCount(0);
    await expect(programAdminPage.getByRole("button", { name: "Complete Visit" })).toHaveCount(0);
    await expect(programAdminPage.getByRole("button", { name: "Start" })).toHaveCount(0);

    const createResponse = await programAdminPage.request.post(
      `/api/pm/visits/${visitId}/actions`,
      {
        data: { action_type: "classroom_observation" },
      }
    );
    expect(createResponse.status()).toBe(403);

    const startResponse = await programAdminPage.request.post(
      `/api/pm/visits/${visitId}/actions/${actionId}/start`,
      {
        data: {
          start_lat: 23.0225,
          start_lng: 72.5714,
          start_accuracy: 10,
        },
      }
    );
    expect(startResponse.status()).toBe(403);

    const endResponse = await programAdminPage.request.post(
      `/api/pm/visits/${visitId}/actions/${actionId}/end`,
      {
        data: {
          end_lat: 23.0225,
          end_lng: 72.5714,
          end_accuracy: 10,
        },
      }
    );
    expect(endResponse.status()).toBe(403);

    const completeResponse = await programAdminPage.request.post(
      `/api/pm/visits/${visitId}/complete`,
      {
        data: {
          end_lat: 23.0225,
          end_lng: 72.5714,
          end_accuracy: 10,
        },
      }
    );
    expect(completeResponse.status()).toBe(403);
  });

  test("legacy-routes-are-gone", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);

    await pmPage.goto(`/visits/${visitId}`);
    await expect(pmPage.locator('a[href*="/principal"]')).toHaveCount(0);
    await expect(pmPage.getByRole("button", { name: "End Visit" })).toHaveCount(0);

    const legacyEndResponse = await pmPage.request.post(
      `/api/pm/visits/${visitId}/end`,
      {
        data: {
          end_lat: 23.0225,
          end_lng: 72.5714,
          end_accuracy: 10,
        },
      }
    );
    expect(legacyEndResponse.status()).toBe(404);
  });

  test("pm-creates-starts-fills-and-ends-af-team-interaction", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);

    // Add AF Team Interaction via picker
    await pmPage.getByRole("button", { name: "Add Action Point" }).click();
    const dialog = pmPage.getByRole("dialog");
    await dialog.getByLabel("AF Team Interaction").click();
    await dialog.getByRole("button", { name: "Add" }).click();

    // Start the action (auto-navigates to action detail)
    const actionCard = pmPage.locator('[data-action-type="af_team_interaction"]').first();
    await expect(actionCard).toBeVisible();
    await actionCard.getByRole("button", { name: "Start" }).click();
    await pmPage.waitForURL(/\/visits\/\d+\/actions\/\d+/);
    const actionId = pmPage.url().split("/actions/")[1]!;

    // Fill the form
    await fillAFTeamInteractionForm(pmPage);

    // Track save-before-end request order
    const requestOrder: string[] = [];
    pmPage.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "PATCH" && url.pathname.includes(`/actions/${actionId}`)) {
        requestOrder.push("patch");
      }
      if (request.method() === "POST" && url.pathname.includes(`/actions/${actionId}/end`)) {
        requestOrder.push("end");
      }
    });

    await pmPage.getByRole("button", { name: "End Action" }).click();

    await expect(
      pmPage.getByText("Completed actions are read-only for your role.")
    ).toBeVisible();
    expect(requestOrder).toEqual(["patch", "end"]);

    // DB assertion
    const actionRows = await pool.query<{ status: string; data: Record<string, unknown> }>(
      `SELECT status, data FROM lms_pm_school_visit_actions WHERE id = $1`,
      [actionId]
    );
    const actionRow = actionRows.rows[0];
    expect(actionRow?.status).toBe("completed");

    const teachers = actionRow?.data?.teachers;
    expect(Array.isArray(teachers)).toBe(true);
    expect((teachers as unknown[]).length).toBeGreaterThan(0);

    const questions = actionRow?.data?.questions as Record<string, unknown>;
    expect(Object.keys(questions)).toHaveLength(9);
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      expect((questions[key] as Record<string, unknown>)?.answer).toBe(true);
    }

    // Navigate back and check card stats
    await pmPage.getByRole("link", { name: "Back to Visit" }).click();
    await pmPage.waitForURL(`/visits/${visitId}`);
    const refreshedCard = pmPage.getByTestId(`action-card-${actionId}`);
    await expect(refreshedCard.getByTestId(`af-team-stats-${actionId}`)).toContainText("9/9 (100%)");
  });

  test("af-team-end-blocked-when-data-incomplete", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "in_progress",
      data: { teachers: [], questions: {} },
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}/actions/${actionId}`);

    await pmPage.getByRole("button", { name: "End Action" }).click();

    await expect(
      pmPage.getByText("Please complete all required fields before ending this interaction.")
    ).toBeVisible();
    await expect(pmPage.getByRole("button", { name: "End Action" })).toBeVisible();

    // DB assertion: action stays in_progress
    const actionRows = await pool.query<{ status: string }>(
      `SELECT status FROM lms_pm_school_visit_actions WHERE id = $1`,
      [actionId]
    );
    expect(actionRows.rows[0]?.status).toBe("in_progress");
  });

  test("visit-cannot-complete-with-only-af-team-interaction", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);
    await pmPage.getByRole("button", { name: "Complete Visit" }).click();

    await expect(
      pmPage.getByText("At least one completed classroom observation is required to complete visit")
    ).toBeVisible();
  });

  test("program-admin-read-only-af-team-interaction", async ({ programAdminPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "in_progress",
      data: buildCompleteAFTeamInteractionData(),
    });

    await programAdminPage.goto(`/visits/${visitId}`);
    const actionCard = programAdminPage.locator('[data-action-type="af_team_interaction"]').first();
    await expect(actionCard).toBeVisible();
    await expect(programAdminPage.getByRole("button", { name: "Add Action Point" })).toHaveCount(0);

    await programAdminPage.goto(`/visits/${visitId}/actions/${actionId}`);
    await expect(programAdminPage.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(programAdminPage.getByRole("button", { name: "End Action" })).toHaveCount(0);

    // Teacher names displayed as static text (not checkboxes)
    await expect(programAdminPage.getByText("Test Teacher")).toBeVisible();
    await expect(programAdminPage.locator('input[type="checkbox"]')).toHaveCount(0);

    // Radio buttons exist but are disabled
    const radios = programAdminPage.locator('input[type="radio"]');
    const radioCount = await radios.count();
    expect(radioCount).toBeGreaterThan(0);
    for (let i = 0; i < radioCount; i++) {
      await expect(radios.nth(i)).toBeDisabled();
    }
  });

  test("visit-completes-with-all-six-required-action-types", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "completed",
      data: buildCompleteIndividualTeacherInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "principal_interaction",
      status: "completed",
      data: buildCompletePrincipalInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "group_student_discussion",
      status: "completed",
      data: buildCompleteGroupStudentDiscussionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_student_discussion",
      status: "completed",
      data: buildCompleteIndividualStudentDiscussionData(),
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);

    // Assert all 6 action cards visible
    await expect(pmPage.locator('[data-action-type="classroom_observation"]').first()).toBeVisible();
    await expect(pmPage.locator('[data-action-type="af_team_interaction"]').first()).toBeVisible();
    await expect(pmPage.locator('[data-action-type="individual_af_teacher_interaction"]').first()).toBeVisible();
    await expect(pmPage.locator('[data-action-type="principal_interaction"]').first()).toBeVisible();
    await expect(pmPage.locator('[data-action-type="group_student_discussion"]').first()).toBeVisible();
    await expect(pmPage.locator('[data-action-type="individual_student_discussion"]').first()).toBeVisible();

    await pmPage.getByRole("button", { name: "Complete Visit" }).click();
    await expect(pmPage.getByText("This visit is completed and read-only.")).toBeVisible();
    await expect(pmPage.getByRole("button", { name: "Complete Visit" })).toHaveCount(0);
  });

  test("pm-creates-starts-fills-and-ends-individual-teacher-interaction", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);

    // Add individual teacher interaction via picker
    await pmPage.getByRole("button", { name: "Add Action Point" }).click();
    const dialog = pmPage.getByRole("dialog");
    await dialog.getByLabel("Individual AF Teacher Interaction").click();
    await dialog.getByRole("button", { name: "Add" }).click();

    // Start the action
    const actionCard = pmPage
      .locator('[data-action-type="individual_af_teacher_interaction"]')
      .first();
    await expect(actionCard).toBeVisible();
    await actionCard.getByRole("button", { name: "Start" }).click();
    await pmPage.waitForURL(/\/visits\/\d+\/actions\/\d+/);
    const actionId = pmPage.url().split("/actions/")[1]!;

    // Fill all teachers (first present + all questions, rest absent)
    await fillAllIndividualTeachers(pmPage);

    // Track save-before-end request order
    const requestOrder: string[] = [];
    pmPage.on("request", (request) => {
      const url = new URL(request.url());
      if (
        request.method() === "PATCH" &&
        url.pathname.includes(`/actions/${actionId}`)
      ) {
        requestOrder.push("patch");
      }
      if (
        request.method() === "POST" &&
        url.pathname.includes(`/actions/${actionId}/end`)
      ) {
        requestOrder.push("end");
      }
    });

    await pmPage.getByRole("button", { name: "End Action" }).click();

    await expect(
      pmPage.getByText("Completed actions are read-only for your role.")
    ).toBeVisible();
    expect(requestOrder).toEqual(["patch", "end"]);

    // DB assertion
    const actionRows = await pool.query<{
      status: string;
      data: Record<string, unknown>;
    }>(
      `SELECT status, data FROM lms_pm_school_visit_actions WHERE id = $1`,
      [actionId]
    );
    const actionRow = actionRows.rows[0];
    expect(actionRow?.status).toBe("completed");

    const teachers = actionRow?.data?.teachers;
    expect(Array.isArray(teachers)).toBe(true);
    expect((teachers as unknown[]).length).toBeGreaterThan(0);

    // Navigate back and check card stats
    await pmPage.getByRole("link", { name: "Back to Visit" }).click();
    await pmPage.waitForURL(`/visits/${visitId}`);
    const refreshedCard = pmPage.getByTestId(`action-card-${actionId}`);
    await expect(
      refreshedCard.getByTestId(`individual-teacher-stats-${actionId}`)
    ).toBeVisible();
  });

  test("individual-teacher-end-blocked-missing-teachers", async ({
    pmPage,
  }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);

    // Seed action with only one of the seeded teachers (not all school teachers)
    const singleTeacher = seededTeachers[0];
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "in_progress",
      data: buildCompleteIndividualTeacherInteractionData([singleTeacher]),
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}/actions/${actionId}`);

    await pmPage.getByRole("button", { name: "End Action" }).click();

    await expect(
      pmPage.getByText(
        "Please complete all required fields and record all teachers before ending this interaction."
      )
    ).toBeVisible();
    await expect(
      pmPage.getByRole("button", { name: "End Action" })
    ).toBeVisible();

    // DB assertion: action stays in_progress
    const actionRows = await pool.query<{ status: string }>(
      `SELECT status FROM lms_pm_school_visit_actions WHERE id = $1`,
      [actionId]
    );
    expect(actionRows.rows[0]?.status).toBe("in_progress");
  });

  test("individual-teacher-absent-on-leave-pass-without-questions", async ({
    pmPage,
  }) => {
    // Get all teachers for the school via API (same query as END route)
    const teacherResp = await pmPage.request.get(
      `/api/pm/teachers?school_code=${schoolCode}`
    );
    expect(teacherResp.ok()).toBeTruthy();
    const { teachers: allSchoolTeachers } = (await teacherResp.json()) as {
      teachers: { id: number; full_name: string | null; email: string }[];
    };

    // Build payload: first present with all questions, rest absent/on_leave
    const teacherEntries = allSchoolTeachers.map((t, i) => {
      if (i === 0) {
        const questions: Record<string, { answer: boolean }> = {};
        for (const key of INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys) {
          questions[key] = { answer: true };
        }
        return {
          id: t.id,
          name: t.full_name || t.email,
          attendance: "present",
          questions,
        };
      }
      const att: string = i % 2 === 0 ? "absent" : "on_leave";
      return {
        id: t.id,
        name: t.full_name || t.email,
        attendance: att,
        questions: {},
      };
    });

    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "in_progress",
      data: { teachers: teacherEntries },
    });

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}/actions/${actionId}`);

    // Verify absent teacher badge is visible and no questions shown when expanded
    const absentTeacher = teacherEntries.find(
      (t) => t.attendance !== "present"
    );
    if (absentTeacher) {
      const badge = pmPage.getByTestId(`teacher-badge-${absentTeacher.id}`);
      await expect(badge).toBeVisible();

      // Expand section to verify no question radios
      await pmPage
        .getByTestId(`teacher-header-${absentTeacher.id}`)
        .click();
      const section = pmPage.getByTestId(
        `teacher-section-${absentTeacher.id}`
      );
      await expect(
        section.locator(
          `[data-testid="teacher-${absentTeacher.id}-oh_class_duration-yes"]`
        )
      ).toHaveCount(0);
    }

    // End action should succeed (all teachers recorded, absent/on_leave pass without questions)
    await pmPage.getByRole("button", { name: "End Action" }).click();
    await expect(
      pmPage.getByText("Completed actions are read-only for your role.")
    ).toBeVisible();

    // DB check
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM lms_pm_school_visit_actions WHERE id = $1`,
      [actionId]
    );
    expect(row.rows[0]?.status).toBe("completed");
  });

  test("visit-completion-requires-individual-teacher-interaction", async ({
    pmPage,
  }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });
    // No individual_af_teacher_interaction seeded

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);
    await pmPage.getByRole("button", { name: "Complete Visit" }).click();

    await expect(
      pmPage.getByText(
        "At least one completed Individual AF Teacher Interaction is required to complete visit"
      )
    ).toBeVisible();
  });

  test("visit-completion-requires-principal-interaction", async ({
    pmPage,
  }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "af_team_interaction",
      status: "completed",
      data: buildCompleteAFTeamInteractionData(),
    });
    await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "completed",
      data: buildCompleteIndividualTeacherInteractionData(),
    });
    // No principal_interaction seeded

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);
    await pmPage.getByRole("button", { name: "Complete Visit" }).click();

    await expect(
      pmPage.getByText(
        "At least one completed Principal Interaction is required to complete visit"
      )
    ).toBeVisible();
  });

  test("program-admin-read-only-individual-teacher-interaction", async ({
    programAdminPage,
  }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "individual_af_teacher_interaction",
      status: "in_progress",
      data: buildCompleteIndividualTeacherInteractionData(seededTeachers),
    });

    await programAdminPage.goto(`/visits/${visitId}`);
    const actionCard = programAdminPage
      .locator(
        '[data-action-type="individual_af_teacher_interaction"]'
      )
      .first();
    await expect(actionCard).toBeVisible();
    await expect(
      programAdminPage.getByRole("button", { name: "Add Action Point" })
    ).toHaveCount(0);

    await programAdminPage.goto(`/visits/${visitId}/actions/${actionId}`);
    await expect(
      programAdminPage.getByRole("button", { name: "Save" })
    ).toHaveCount(0);
    await expect(
      programAdminPage.getByRole("button", { name: "End Action" })
    ).toHaveCount(0);

    // No add/remove controls
    await expect(
      programAdminPage.getByTestId("add-teacher-select")
    ).toHaveCount(0);
    await expect(
      programAdminPage.locator('[data-testid^="remove-teacher-"]')
    ).toHaveCount(0);

    // Expand first teacher section
    const teacherId = seededTeachers[0].id;
    await programAdminPage
      .getByTestId(`teacher-header-${teacherId}`)
      .click();

    // Teacher name displayed
    await expect(
      programAdminPage.getByText(seededTeachers[0].name)
    ).toBeVisible();

    // Read-only: attendance text visible, no radio inputs in form
    const section = programAdminPage.getByTestId(
      `teacher-section-${teacherId}`
    );
    await expect(section.getByText("Attendance:")).toBeVisible();
    await expect(
      section.locator('input[type="radio"]')
    ).toHaveCount(0);
  });

  test("pm-creates-fills-and-ends-both-student-interaction-types", async ({ pmPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);

    await setGoodGps(pmPage);
    await pmPage.goto(`/visits/${visitId}`);

    // ─── Group Student Discussion (Student Interaction) ───

    // Add via picker
    await pmPage.getByRole("button", { name: "Add Action Point" }).click();
    const dialog1 = pmPage.getByRole("dialog");
    await dialog1.getByLabel("Student Interaction").click();
    await dialog1.getByRole("button", { name: "Add" }).click();

    // Start the action
    const groupCard = pmPage.locator('[data-action-type="group_student_discussion"]').first();
    await expect(groupCard).toBeVisible();
    await groupCard.getByRole("button", { name: "Start" }).click();
    await pmPage.waitForURL(/\/visits\/\d+\/actions\/\d+/);
    const groupActionId = pmPage.url().split("/actions/")[1]!;

    // Fill the form
    await fillGroupStudentDiscussionForm(pmPage);

    // Track save-before-end request order
    const groupRequestOrder: string[] = [];
    pmPage.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "PATCH" && url.pathname.includes(`/actions/${groupActionId}`)) {
        groupRequestOrder.push("patch");
      }
      if (request.method() === "POST" && url.pathname.includes(`/actions/${groupActionId}/end`)) {
        groupRequestOrder.push("end");
      }
    });

    // End the action
    await pmPage.getByRole("button", { name: "End Action" }).click();
    await expect(
      pmPage.getByText("Completed actions are read-only for your role.")
    ).toBeVisible();
    expect(groupRequestOrder).toEqual(["patch", "end"]);

    // DB assertion
    const groupRows = await pool.query<{ status: string; data: Record<string, unknown> }>(
      `SELECT status, data FROM lms_pm_school_visit_actions WHERE id = $1`,
      [groupActionId]
    );
    const groupRow = groupRows.rows[0];
    expect(groupRow?.status).toBe("completed");
    expect(groupRow?.data?.grade).toBe(11);
    const groupQuestions = groupRow?.data?.questions as Record<string, unknown>;
    expect(Object.keys(groupQuestions)).toHaveLength(4);
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      expect((groupQuestions[key] as Record<string, unknown>)?.answer).toBe(true);
    }

    // Navigate back to visit detail
    await pmPage.getByRole("link", { name: "Back to Visit" }).click();
    await pmPage.waitForURL(`/visits/${visitId}`);

    // Verify group action card shows completed stats
    const refreshedGroupCard = pmPage.getByTestId(`action-card-${groupActionId}`);
    await expect(
      refreshedGroupCard.getByTestId(`group-student-stats-${groupActionId}`)
    ).toContainText("4/4 (100%)");

    // ─── Individual Student Discussion (Individual Student Interaction) ───

    // Add via picker
    await pmPage.getByRole("button", { name: "Add Action Point" }).click();
    const dialog2 = pmPage.getByRole("dialog");
    await dialog2.getByLabel("Individual Student Interaction").click();
    await dialog2.getByRole("button", { name: "Add" }).click();

    // Start the action
    const individualCard = pmPage.locator('[data-action-type="individual_student_discussion"]').first();
    await expect(individualCard).toBeVisible();
    await individualCard.getByRole("button", { name: "Start" }).click();
    await pmPage.waitForURL(/\/visits\/\d+\/actions\/\d+/);
    const individualActionId = pmPage.url().split("/actions/")[1]!;

    // Fill the form
    await fillIndividualStudentDiscussionForm(pmPage);

    // Track save-before-end request order
    const individualRequestOrder: string[] = [];
    pmPage.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "PATCH" && url.pathname.includes(`/actions/${individualActionId}`)) {
        individualRequestOrder.push("patch");
      }
      if (request.method() === "POST" && url.pathname.includes(`/actions/${individualActionId}/end`)) {
        individualRequestOrder.push("end");
      }
    });

    // End the action
    await pmPage.getByRole("button", { name: "End Action" }).click();
    await expect(
      pmPage.getByText("Completed actions are read-only for your role.")
    ).toBeVisible();
    expect(individualRequestOrder).toEqual(["patch", "end"]);

    // DB assertion
    const individualRows = await pool.query<{ status: string; data: Record<string, unknown> }>(
      `SELECT status, data FROM lms_pm_school_visit_actions WHERE id = $1`,
      [individualActionId]
    );
    const individualRow = individualRows.rows[0];
    expect(individualRow?.status).toBe("completed");
    const students = individualRow?.data?.students as Array<Record<string, unknown>>;
    expect(Array.isArray(students)).toBe(true);
    expect(students.length).toBeGreaterThanOrEqual(1);
    expect(students[0]?.grade).toBe(11);

    // Navigate back and verify both completed action cards visible
    await pmPage.getByRole("link", { name: "Back to Visit" }).click();
    await pmPage.waitForURL(`/visits/${visitId}`);

    const refreshedIndividualCard = pmPage.getByTestId(`action-card-${individualActionId}`);
    await expect(
      refreshedIndividualCard.getByTestId(`individual-student-stats-${individualActionId}`)
    ).toBeVisible();

    // Both action types show as completed on the visit detail page
    await expect(refreshedGroupCard.getByRole("link", { name: "View Details" })).toBeVisible();
    await expect(refreshedIndividualCard.getByRole("link", { name: "View Details" })).toBeVisible();
  });
});
