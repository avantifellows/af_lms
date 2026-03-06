import { test, expect } from "../fixtures/auth";
import {
  buildCompleteClassroomObservationData,
  getTestPool,
  seedTestVisit,
  seedVisitAction,
} from "../helpers/db";
import type { Page } from "@playwright/test";
import type { Pool } from "pg";

let pool: Pool;
let schoolCode: string;

async function setGoodGps(page: Page) {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({
    latitude: 23.0225,
    longitude: 72.5714,
    accuracy: 50,
  });
}

async function fillClassroomRubricScores(page: Page) {
  const rubricCards = page.locator('[data-testid^="rubric-param-"]');
  await expect(rubricCards).toHaveCount(19);

  const count = await rubricCards.count();
  for (let index = 0; index < count; index += 1) {
    await rubricCards.nth(index).locator('input[type="radio"]').first().check();
  }

  await expect(page.getByTestId("rubric-answered-summary")).toHaveText("Answered: 19/19");
}

test.beforeAll(async () => {
  pool = getTestPool();

  const schoolResult = await pool.query(
    `SELECT code FROM school WHERE region = 'AHMEDABAD' LIMIT 1`
  );
  if (schoolResult.rows.length > 0) {
    schoolCode = schoolResult.rows[0].code as string;
    return;
  }

  schoolCode = "E2EAHM001";
  await pool.query(
    `INSERT INTO school (code, name, region, inserted_at, updated_at)
     SELECT $1::varchar, 'E2E Test School Ahmedabad', 'AHMEDABAD', NOW(), NOW()
     WHERE NOT EXISTS (SELECT 1 FROM school WHERE code = $1::varchar)`,
    [schoolCode]
  );
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
    await dialog.getByLabel("Teacher Feedback").click();
    await dialog.getByRole("button", { name: "Add" }).click();

    const pendingCard = pmPage.locator('[data-action-type="teacher_feedback"]').first();
    await expect(pendingCard).toBeVisible();
    await expect(pendingCard.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(pendingCard.getByRole("button", { name: "Delete" })).toBeVisible();

    await pendingCard.getByRole("button", { name: "Delete" }).click();
    await expect(pmPage.locator('[data-action-type="teacher_feedback"]')).toHaveCount(0);
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
    await expect(actionCard.getByRole("link", { name: "Open" })).toBeVisible();
    await actionCard.getByRole("link", { name: "Open" }).click();

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
      `SELECT status, data FROM lms_pm_visit_actions WHERE id = $1`,
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
    await actionCard.getByRole("link", { name: "Open" }).click();

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
      actionType: "principal_meeting",
      status: "completed",
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
      actionType: "principal_meeting",
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
      actionType: "principal_meeting",
      status: "pending",
    });
    await seedVisitAction(pool, visitId, {
      actionType: "classroom_observation",
      status: "completed",
      data: buildCompleteClassroomObservationData(),
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
      actionType: "principal_meeting",
      status: "completed",
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

    await adminPage.getByRole("button", { name: "Complete Visit" }).click();
    await expect(adminPage.getByText("This visit is completed and read-only.")).toBeVisible();
  });

  test("program-admin-read-only", async ({ programAdminPage }) => {
    const { visitId } = await seedTestVisit(pool, schoolCode);
    const { actionId } = await seedVisitAction(pool, visitId, {
      actionType: "principal_meeting",
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
});
