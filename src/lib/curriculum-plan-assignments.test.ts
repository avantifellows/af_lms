import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "./__test-utils__/fake-db";

const { db, mockCheckSchema } = vi.hoisted(() => ({
  db: { current: null as unknown as ReturnType<typeof import("./__test-utils__/fake-db").createFakeDb> },
  mockCheckSchema: vi.fn(),
}));

vi.mock("./db", () => ({
  query: (sql: string, params?: unknown[]) => db.current.query(sql, params),
  withTransaction: (fn: (client: unknown) => Promise<unknown>) => db.current.withTransaction(fn),
}));
vi.mock("./curriculum-schema", () => ({ checkCurriculumPlansSchema: mockCheckSchema }));

import {
  previewPlanAssignment,
  saveCentrePlanAssignments,
  savePlanAssignmentByPlan,
} from "./curriculum-plan-assignments";

const ADMIN_EMAIL = "admin@avantifellows.org";

const PLAN = {
  id: 7,
  title: "G11 2026-27",
  status: "draft",
  academic_year: "2026-2027",
  grade_id: 11,
  exam_tracks: ["jee_main", "neet"],
  closure_date: "2027-03-08",
};

function eligibleCentre(id: number, name: string, currentPlan: { id: number; title: string } | null) {
  return {
    centre_id: id,
    centre_name: name,
    school_name: `${name} School`,
    school_code: `S${id}`,
    region: "NORTH",
    program_name: "JNV Nodal",
    mapped_tracks: ["jee_main"],
    current_plan_id: currentPlan?.id ?? null,
    current_plan_title: currentPlan?.title ?? null,
  };
}

const UNIQUE_VIOLATION = Object.assign(new Error("duplicate key value"), { code: "23505" });

beforeEach(() => {
  vi.resetAllMocks();
  mockCheckSchema.mockResolvedValue({ ok: true });
  db.current = createFakeDb([
    [/FROM lms_curriculum_plans\s+WHERE id = \$1/, [PLAN]],
    ["SELECT DISTINCT cfg.exam_track", [{ exam_track: "jee_main" }, { exam_track: "neet" }]],
    [
      "AS current_plan_title",
      [
        eligibleCentre(1, "Anand", { id: 7, title: "G11 2026-27" }),
        eligibleCentre(2, "Bhuj", { id: 8, title: "G11 HYD" }),
        eligibleCentre(3, "Surat", null),
      ],
    ],
    [
      "AS assigned_centre_name",
      [
        { centre_id: 1, assigned_centre_name: "Anand" },
        // Assigned to this plan but no longer eligible (deactivated, or tracks unmapped).
        { centre_id: 9, assigned_centre_name: "Vapi" },
      ],
    ],
  ]);
});

describe("previewPlanAssignment", () => {
  it("counts moves from other plans and lists every assignment the save removes", async () => {
    const result = await previewPlanAssignment({ id: 7, body: { centre_ids: [2, 3] } });

    expect(result).toEqual({
      ok: true,
      preview: {
        centres: [
          {
            centreId: 2,
            centreName: "Bhuj",
            currentPlan: { id: 8, title: "G11 HYD" },
            moves: true,
            uncoveredTracks: [],
          },
          { centreId: 3, centreName: "Surat", currentPlan: null, moves: false, uncoveredTracks: [] },
        ],
        moveCount: 1,
        removeCount: 2,
        removedCentres: [
          { centreId: 1, centreName: "Anand", eligible: true },
          { centreId: 9, centreName: "Vapi", eligible: false },
        ],
      },
    });
  });

  it("removes nothing while every assigned Centre stays ticked, even one no longer eligible", async () => {
    db.current.on("AS assigned_centre_name", [{ centre_id: 1, assigned_centre_name: "Anand" }]);

    const result = await previewPlanAssignment({ id: 7, body: { centre_ids: [1] } });

    expect(result).toMatchObject({ ok: true, preview: { moveCount: 0, removeCount: 0, removedCentres: [] } });
  });

  it("rejects a Centre that is not eligible for the plan", async () => {
    const result = await previewPlanAssignment({ id: 7, body: { centre_ids: [9] } });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Invalid Curriculum Plan",
      errors: [{ field: "centre_ids", message: "Centre 9 is not an eligible Centre for this plan" }],
    });
  });
});

describe("savePlanAssignmentByPlan", () => {
  it("returns 409 when another save assigns a ticked Centre at the same time", async () => {
    db.current.on("INSERT INTO lms_curriculum_plan_assignments", () => {
      throw UNIQUE_VIOLATION;
    });

    const result = await savePlanAssignmentByPlan({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: { centre_ids: [1, 3] },
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "A Centre was assigned to another plan at the same time; reload and try again",
    });
  });

  it("rethrows any other database error", async () => {
    db.current.on("INSERT INTO lms_curriculum_plan_assignments", () => {
      throw new Error("connection lost");
    });

    await expect(
      savePlanAssignmentByPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { centre_ids: [1] } })
    ).rejects.toThrow("connection lost");
  });
});

describe("saveCentrePlanAssignments", () => {
  it("returns 409 when the Centre is assigned to another plan at the same time", async () => {
    db.current.on("FOR UPDATE OF p", [{ id: 7, academic_year: "2026-2027", grade_id: 11, grade: 11 }]);
    db.current.on("SELECT DISTINCT g.number AS grade", [{ grade: 11 }]);
    db.current.on("INSERT INTO lms_curriculum_plan_assignments", () => {
      throw UNIQUE_VIOLATION;
    });

    const result = await saveCentrePlanAssignments({
      centreId: 1,
      adminEmail: ADMIN_EMAIL,
      body: { academic_year: "2026-2027", assignments: [{ grade: 11, plan_id: 7 }] },
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "The Centre was assigned to another plan at the same time; reload and try again",
    });
  });
});
