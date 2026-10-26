// The one-time workbook seed's database side (#425): the Curriculum Plans module's effective
// Chapter list, plan list and atomic Draft creation, so the seed gets the plan editor's
// validation. Server-only; the seed script loads it after reading its env file.

import { CONTENT_EXAM_TRACKS } from "./curriculum-plan-rules";
import type { CurriculumPlanSeedStore } from "./curriculum-plan-seed";
import {
  createCurriculumPlanDrafts,
  listCurriculumPlans,
  listEffectiveChaptersForGrade,
} from "./curriculum-plans";

export function curriculumPlanSeedStore(params: {
  adminEmail: string;
  // Test-before-due warnings on the created plans.
  onWarning: (message: string) => void;
}): CurriculumPlanSeedStore {
  return {
    async loadChapters(grade) {
      const chapters = await listEffectiveChaptersForGrade(grade, CONTENT_EXAM_TRACKS);
      return chapters.map(({ chapterId, chapterCode, chapterName, subjectName }) => ({
        chapterId,
        chapterCode,
        chapterName,
        subjectName,
      }));
    },
    async existingPlanTitles(academicYear, grade) {
      const listed = await listCurriculumPlans({ academicYear, grade });
      if (!listed.ok) throw new Error(`${listed.error}: ${listed.details.join("; ")}`);
      return listed.plans.map((plan) => plan.title);
    },
    async createDraftPlans(drafts) {
      const created = await createCurriculumPlanDrafts({ adminEmail: params.adminEmail, drafts });
      if (!created.ok) throw new Error(`Nothing was created. ${created.error}`);
      for (const plan of created.plans) {
        for (const warning of plan.warnings) {
          params.onWarning(`Warning (${plan.title}): ${warning.chapterName}: ${warning.message}`);
        }
      }
      return created.plans.map(({ id }) => ({ id }));
    },
  };
}
