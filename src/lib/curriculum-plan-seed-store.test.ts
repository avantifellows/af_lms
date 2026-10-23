import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockList, mockListChapters, mockCreateDrafts } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockListChapters: vi.fn(),
  mockCreateDrafts: vi.fn(),
}));

vi.mock("./curriculum-plans", () => ({
  listCurriculumPlans: mockList,
  listEffectiveChaptersForGrade: mockListChapters,
  createCurriculumPlanDrafts: mockCreateDrafts,
}));

import { curriculumPlanSeedStore } from "./curriculum-plan-seed-store";
import type { PlanDraft } from "./curriculum-plan-seed";

const DRAFT: PlanDraft = {
  tab: "G12",
  title: "G12 2026-27",
  academicYear: "2026-2027",
  grade: 12,
  examTracks: ["jee_main", "jee_advanced", "neet"],
  closureDate: "2026-11-30",
  chapters: [{ chapterId: 1223, dueDate: "2026-07-10", testDate: "2026-07-09" }],
};

const onWarning = vi.fn();
const store = () => curriculumPlanSeedStore({ adminEmail: "admin@avantifellows.org", onWarning });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("curriculumPlanSeedStore", () => {
  it("loads the Grade's effective Chapters for every content track", async () => {
    mockListChapters.mockResolvedValue([
      {
        chapterId: 1223,
        chapterCode: "12P23",
        chapterName: "Ray Optics",
        subjectId: 4,
        subjectName: "Physics",
        dueDate: null,
        testDate: null,
      },
    ]);

    await expect(store().loadChapters(12)).resolves.toEqual([
      { chapterId: 1223, chapterCode: "12P23", chapterName: "Ray Optics", subjectName: "Physics" },
    ]);
    expect(mockListChapters).toHaveBeenCalledWith(12, ["jee_main", "jee_advanced", "neet"]);
  });

  it("lists existing plan titles, and fails when the plan schema is missing", async () => {
    mockList.mockResolvedValueOnce({ ok: true, plans: [{ title: "G12 2026-27" }] });
    await expect(store().existingPlanTitles("2026-2027", 12)).resolves.toEqual(["G12 2026-27"]);
    expect(mockList).toHaveBeenCalledWith({ academicYear: "2026-2027", grade: 12 });

    mockList.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_curriculum_plans.id"],
    });
    await expect(store().existingPlanTitles("2026-2027", 12)).rejects.toThrow(
      "LMS curriculum schema unavailable: lms_curriculum_plans.id"
    );
  });

  it("creates every draft at once and reports test-before-due warnings", async () => {
    mockCreateDrafts.mockResolvedValue({
      ok: true,
      plans: [
        {
          id: 100,
          title: "G12 2026-27",
          warnings: [{ chapterId: 1223, chapterName: "Ray Optics", message: "Chapter Test Date is before its Chapter Due Date" }],
        },
      ],
    });

    await expect(store().createDraftPlans([DRAFT])).resolves.toEqual([{ id: 100 }]);
    expect(mockCreateDrafts).toHaveBeenCalledWith({ adminEmail: "admin@avantifellows.org", drafts: [DRAFT] });
    expect(onWarning).toHaveBeenCalledWith(
      "Warning (G12 2026-27): Ray Optics: Chapter Test Date is before its Chapter Due Date"
    );
  });

  it("throws when any draft is rejected, so nothing is reported as created", async () => {
    mockCreateDrafts.mockResolvedValue({ ok: false, error: 'Could not create "G12 2026-27": Invalid Curriculum Plan' });

    await expect(store().createDraftPlans([DRAFT])).rejects.toThrow(
      'Nothing was created. Could not create "G12 2026-27": Invalid Curriculum Plan'
    );
  });
});
