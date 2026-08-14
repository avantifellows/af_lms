import { describe, expect, it } from "vitest";

import {
  CURRICULUM_LOG_TYPES,
  CURRICULUM_LOG_TYPE_LABELS,
  isWritableCurriculumLogType,
} from "./curriculum-log-types";

describe("curriculum log types", () => {
  it("keeps one closed writable vocabulary with labels", () => {
    expect(CURRICULUM_LOG_TYPES).toEqual([
      "regular",
      "class_cancelled",
      "doubt_solving",
    ]);
    expect(CURRICULUM_LOG_TYPE_LABELS).toEqual({
      regular: "Regular Class",
      class_cancelled: "Class Cancelled",
      doubt_solving: "Doubt Solving",
    });
    expect(CURRICULUM_LOG_TYPES.every(isWritableCurriculumLogType)).toBe(true);
    expect(isWritableCurriculumLogType("other")).toBe(false);
  });
});
