import type { CurriculumPlanDisplayStatus } from "@/lib/curriculum-plan-rules";

export const PLAN_STATUS_LABELS: Record<CurriculumPlanDisplayStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
};

export const PLAN_STATUS_BADGE_VARIANTS = {
  draft: "default",
  active: "success",
  closed: "info",
} as const satisfies Record<CurriculumPlanDisplayStatus, string>;
