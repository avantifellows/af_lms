export const CURRICULUM_LOG_TYPES = [
  "regular",
  "class_cancelled",
  "doubt_solving",
] as const;

export type CurriculumLogType = (typeof CURRICULUM_LOG_TYPES)[number];
export type WritableCurriculumLogType = CurriculumLogType;

export const CURRICULUM_LOG_TYPE_LABELS: Record<CurriculumLogType, string> = {
  regular: "Regular Class",
  class_cancelled: "Class Cancelled",
  doubt_solving: "Doubt Solving",
};

export function isWritableCurriculumLogType(
  value: unknown
): value is WritableCurriculumLogType {
  return (
    typeof value === "string" &&
    (CURRICULUM_LOG_TYPES as readonly string[]).includes(value)
  );
}
