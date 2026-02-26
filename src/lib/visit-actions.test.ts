import { describe, expect, it } from "vitest";

import {
  ACTION_STATUS_VALUES,
  ACTION_TYPES,
  ACTION_TYPE_VALUES,
  getActionTypeLabel,
  isActionType,
  statusBadgeClass,
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

describe("statusBadgeClass", () => {
  it("returns success bg + accent-hover text for completed status", () => {
    const classes = statusBadgeClass("completed");
    expect(classes).toContain("bg-success-bg");
    expect(classes).toContain("text-accent-hover");
    expect(classes).toContain("rounded-full");
    expect(classes).toContain("text-xs");
    expect(classes).toContain("font-medium");
  });

  it("returns warning bg + warning text for in_progress status", () => {
    const classes = statusBadgeClass("in_progress");
    expect(classes).toContain("bg-warning-bg");
    expect(classes).toContain("text-warning-text");
    expect(classes).toContain("rounded-full");
  });

  it("returns card-alt bg + secondary text for pending status", () => {
    const classes = statusBadgeClass("pending");
    expect(classes).toContain("bg-bg-card-alt");
    expect(classes).toContain("text-text-secondary");
    expect(classes).toContain("rounded-full");
  });

  it("returns default muted fallback for unknown status", () => {
    const classes = statusBadgeClass("unknown_value");
    expect(classes).toContain("bg-bg-card-alt");
    expect(classes).toContain("text-text-muted");
    expect(classes).toContain("rounded-full");
  });
});
