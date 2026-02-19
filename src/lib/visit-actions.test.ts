import { describe, expect, it } from "vitest";

import {
  ACTION_STATUS_VALUES,
  ACTION_TYPES,
  ACTION_TYPE_VALUES,
  getActionTypeLabel,
  isActionType,
  type ActionType,
} from "./visit-actions";

describe("visit-actions", () => {
  it("defines all MVP action types with exhaustive ActionType coverage", () => {
    const exhaustiveByType: Record<ActionType, true> = {
      principal_meeting: true,
      leadership_meeting: true,
      classroom_observation: true,
      group_student_discussion: true,
      individual_student_discussion: true,
      individual_staff_meeting: true,
      team_staff_meeting: true,
      teacher_feedback: true,
    };

    expect(Object.keys(exhaustiveByType)).toHaveLength(8);
    expect(ACTION_TYPE_VALUES).toEqual(Object.keys(ACTION_TYPES));
  });

  it("validates action types at runtime", () => {
    expect(isActionType("classroom_observation")).toBe(true);
    expect(isActionType("unknown_action")).toBe(false);
    expect(getActionTypeLabel("teacher_feedback")).toBe("Teacher Feedback");
  });

  it("defines allowed action statuses", () => {
    expect(ACTION_STATUS_VALUES).toEqual(["pending", "in_progress", "completed"]);
  });
});
