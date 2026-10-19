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
  listCentreCoverage,
  listPlanAssignmentCentres,
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

const SCHEMA_UNAVAILABLE = {
  ok: false,
  status: 503,
  error: "LMS curriculum schema unavailable",
  details: ["lms_curriculum_plan_assignments.centre_id"],
};

describe("listPlanAssignmentCentres", () => {
  it("lists eligible Centres with their current plan and the tracks the plan can't measure", async () => {
    db.current.on("SELECT number FROM grade", [{ number: 11 }]);
    db.current.on("AS current_plan_title", [
      { ...eligibleCentre(1, "Anand", null), region: null, mapped_tracks: ["jee_main", "cet", "jee_advanced"] },
    ]);

    const result = await listPlanAssignmentCentres(7);

    expect(result).toEqual({
      ok: true,
      plan: { id: 7, title: "G11 2026-27", academicYear: "2026-2027", grade: 11 },
      centres: [
        {
          centreId: 1,
          centreName: "Anand",
          schoolName: "Anand School",
          schoolCode: "S1",
          region: "",
          programName: "JNV Nodal",
          mappedTracks: ["jee_main", "cet", "jee_advanced"],
          uncoveredTracks: ["jee_advanced", "cet"],
          currentPlan: null,
        },
      ],
    });
  });

  it("is not found for a bad id or a missing plan, and reports a missing schema", async () => {
    await expect(listPlanAssignmentCentres(0)).resolves.toMatchObject({ status: 404 });
    db.current.on(/FROM lms_curriculum_plans\s+WHERE id = \$1/, []);
    await expect(listPlanAssignmentCentres(7)).resolves.toMatchObject({ status: 404 });
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(listPlanAssignmentCentres(7)).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});

describe("previewPlanAssignment input", () => {
  it.each([[{}], [{ centre_ids: "1" }], [{ centre_ids: [1, 0] }], [null]])(
    "rejects %j as Centre ids",
    async (body) => {
      await expect(previewPlanAssignment({ id: 7, body })).resolves.toMatchObject({
        status: 400,
        errors: [{ field: "centre_ids", message: "centre_ids must be a list of Centre ids" }],
      });
    }
  );

  it("is not found for a bad id or a missing plan, and reports a missing schema", async () => {
    await expect(previewPlanAssignment({ id: -1, body: { centre_ids: [] } })).resolves.toMatchObject({
      status: 404,
    });
    db.current.on(/FROM lms_curriculum_plans\s+WHERE id = \$1/, []);
    await expect(previewPlanAssignment({ id: 7, body: { centre_ids: [] } })).resolves.toMatchObject({
      status: 404,
    });
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(previewPlanAssignment({ id: 7, body: { centre_ids: [] } })).resolves.toEqual(
      SCHEMA_UNAVAILABLE
    );
  });
});

describe("savePlanAssignmentByPlan writes", () => {
  it("moves, adds and removes so the ticked Centres are exactly the plan's", async () => {
    db.current.on("NOT (centre_id = ANY($2::bigint[]))", [{ id: 91 }, { id: 92 }]);
    db.current.on("AND plan_id <> $4", [{ id: 93 }]);
    db.current.on("INSERT INTO lms_curriculum_plan_assignments", [{ id: 94 }, { id: 95 }]);

    const result = await savePlanAssignmentByPlan({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: { centre_ids: [2, 3, 2] },
    });

    expect(result).toEqual({ ok: true, assignedCount: 2, added: 2, moved: 1, removed: 2 });
    expect(db.current.sqlCalls("INSERT INTO lms_curriculum_plan_assignments")[0].params).toEqual([
      7,
      [2, 3],
      11,
      "2026-2027",
      ADMIN_EMAIL,
    ]);
    expect(db.current.transactions).toEqual(["committed"]);
  });

  it("returns 409 when existing rows don't match the plan's academic year and Grade", async () => {
    db.current.on("AND (grade_id <> $2 OR academic_year <> $3)", [{ "?column?": 1 }]);

    const result = await savePlanAssignmentByPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { centre_ids: [1] } });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Plan Assignments do not match the plan's academic year and Grade",
    });
    expect(db.current.sqlCalls("DELETE FROM lms_curriculum_plan_assignments")).toHaveLength(0);
  });

  it("rejects an ineligible Centre and a missing plan without writing", async () => {
    await expect(
      savePlanAssignmentByPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { centre_ids: [9] } })
    ).resolves.toMatchObject({ status: 400 });
    db.current.on("FOR UPDATE", []);
    await expect(
      savePlanAssignmentByPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { centre_ids: [1] } })
    ).resolves.toMatchObject({ status: 404 });
    expect(db.current.sqlCalls("DELETE FROM lms_curriculum_plan_assignments")).toHaveLength(0);
  });
});

describe("listCentreCoverage", () => {
  function coverageRow(overrides: Record<string, unknown>) {
    return {
      centre_id: 1,
      centre_name: "Anand",
      school_name: "Anand School",
      region: "NORTH",
      program_name: "JNV Nodal",
      grade: 11,
      mapped_tracks: ["jee_main", "neet"],
      plan_id: null,
      plan_title: null,
      plan_status: null,
      plan_closure_date: null,
      plan_exam_tracks: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    db.current.on("SELECT DISTINCT g.number AS grade, cfg.exam_track", [
      { grade: 11, exam_track: "jee_main" },
      { grade: 11, exam_track: "neet" },
      { grade: 12, exam_track: "jee_main" },
    ]);
    db.current.on("FROM lms_curriculum_plans p", []);
  });

  it("folds Centre + Grade rows into one row per Centre with each Grade's plan", async () => {
    db.current.on("AS plan_exam_tracks", [
      coverageRow({
        plan_id: 7,
        plan_title: "G11 Others",
        plan_status: "active",
        plan_closure_date: "2020-01-01",
        plan_exam_tracks: ["jee_main"],
      }),
      coverageRow({
        grade: 12,
        mapped_tracks: ["jee_main"],
        plan_id: 8,
        plan_title: "G12",
        plan_status: null,
        plan_closure_date: null,
        plan_exam_tracks: null,
      }),
      coverageRow({ centre_id: 2, centre_name: "Bhuj", region: null, grade: 12, mapped_tracks: ["neet"] }),
    ]);

    const result = await listCentreCoverage("2026-2027");

    expect(result).toEqual({
      ok: true,
      academicYear: "2026-2027",
      plans: [],
      centres: [
        {
          centreId: 1,
          centreName: "Anand",
          schoolName: "Anand School",
          region: "NORTH",
          programName: "JNV Nodal",
          grades: {
            11: {
              mappedTracks: ["jee_main", "neet"],
              plan: { id: 7, title: "G11 Others", displayStatus: "closed" },
              uncoveredTracks: ["neet"],
            },
            12: {
              mappedTracks: ["jee_main"],
              plan: { id: 8, title: "G12", displayStatus: "draft" },
              uncoveredTracks: ["jee_main"],
            },
          },
        },
        {
          centreId: 2,
          centreName: "Bhuj",
          schoolName: "Anand School",
          region: "",
          programName: "JNV Nodal",
          grades: { 11: null, 12: { mappedTracks: ["neet"], plan: null, uncoveredTracks: [] } },
        },
      ],
    });
    expect(db.current.sqlCalls("AS plan_exam_tracks")[0].params).toEqual(["2026-2027", [11, 12]]);
  });

  it("reports a missing schema", async () => {
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(listCentreCoverage("2026-2027")).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });

  it("reports a missing schema found while listing the plans", async () => {
    mockCheckSchema.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(SCHEMA_UNAVAILABLE);
    await expect(listCentreCoverage("2026-2027")).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});

describe("saveCentrePlanAssignments writes", () => {
  const BODY = {
    academic_year: "2026-2027",
    assignments: [
      { grade: 11, plan_id: 7 },
      { grade: 12, plan_id: null },
    ],
  };

  beforeEach(() => {
    db.current.on("FOR UPDATE OF p", [{ id: 7, academic_year: "2026-2027", grade_id: 3, grade: 11 }]);
    db.current.on("SELECT DISTINCT g.number AS grade\n", [{ grade: 11 }, { grade: 12 }]);
  });

  it("moves the Centre onto the chosen plan per Grade, or off every plan for null", async () => {
    const result = await saveCentrePlanAssignments({ centreId: 41, adminEmail: ADMIN_EMAIL, body: BODY });

    expect(result).toEqual({
      ok: true,
      assignments: [
        { grade: 11, planId: 7 },
        { grade: 12, planId: null },
      ],
    });
    expect(db.current.sqlCalls("DELETE FROM lms_curriculum_plan_assignments").map((call) => call.params)).toEqual([
      [41, "2026-2027", 11, 7],
      [41, "2026-2027", 12, null],
    ]);
    expect(db.current.sqlCalls("INSERT INTO lms_curriculum_plan_assignments").map((call) => call.params)).toEqual([
      [7, 41, 3, "2026-2027", ADMIN_EMAIL],
    ]);
    expect(db.current.sqlCalls("FOR UPDATE OF p")[0].params).toEqual([[7]]);
  });

  it("rejects an ineligible Grade, a missing plan and a plan of another year or Grade, writing nothing", async () => {
    db.current.on("SELECT DISTINCT g.number AS grade\n", [{ grade: 12 }]);
    db.current.on("FOR UPDATE OF p", [{ id: 8, academic_year: "2025-2026", grade_id: 4, grade: 12 }]);

    const result = await saveCentrePlanAssignments({
      centreId: 41,
      adminEmail: ADMIN_EMAIL,
      body: {
        academic_year: "2026-2027",
        assignments: [
          { grade: 11, plan_id: 7 },
          { grade: 12, plan_id: 8 },
        ],
      },
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Invalid Curriculum Plan",
      errors: [
        { field: "assignments", message: "Centre 41 is not an eligible Centre for Grade 11" },
        { field: "assignments", message: "Curriculum Plan 7 was not found" },
        { field: "assignments", message: "Curriculum Plan 8 is not a Grade 12 plan for 2026-2027" },
      ],
    });
    expect(db.current.sqlCalls("DELETE FROM lms_curriculum_plan_assignments")).toHaveLength(0);
  });

  it("is not found for a bad Centre id, and reports a missing schema", async () => {
    await expect(
      saveCentrePlanAssignments({ centreId: 0, adminEmail: ADMIN_EMAIL, body: BODY })
    ).resolves.toEqual({ ok: false, status: 404, error: "Centre not found" });
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(
      saveCentrePlanAssignments({ centreId: 41, adminEmail: ADMIN_EMAIL, body: BODY })
    ).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });

  it("rethrows any other database error", async () => {
    db.current.on("INSERT INTO lms_curriculum_plan_assignments", () => {
      throw new Error("connection lost");
    });
    await expect(
      saveCentrePlanAssignments({ centreId: 41, adminEmail: ADMIN_EMAIL, body: BODY })
    ).rejects.toThrow("connection lost");
  });
});
