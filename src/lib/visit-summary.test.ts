import { describe, expect, it } from "vitest";

import { ACTION_TYPE_VALUES, type ActionType } from "./visit-actions";
import {
  classifyActionCompletion,
  computeAverageCompletion,
  resolvePresetDateRange,
  rollupActionTypes,
  type ActionTypeRollupStatus,
  type RemarkEntry,
} from "./visit-summary";

describe("rollupActionTypes", () => {
  it("marks missing action types as not_started and ignores unknown action types", () => {
    const rollup = rollupActionTypes([
      { action_type: "classroom_observation", status: "completed" },
      { action_type: "unknown_action", status: "completed" },
    ]);

    expect(rollup.classroom_observation).toBe("completed");
    expect(rollup.principal_interaction).toBe("not_started");
    expect(Object.keys(rollup)).toEqual(ACTION_TYPE_VALUES);
    expect(rollup).not.toHaveProperty("unknown_action");

    const exhaustive: Record<ActionType, true> = Object.fromEntries(
      Object.keys(rollup).map((key) => [key, true])
    ) as Record<ActionType, true>;
    expect(Object.keys(exhaustive)).toHaveLength(7);
  });

  it("keeps the best status when a type has duplicate actions", () => {
    const rollup = rollupActionTypes([
      { action_type: "af_team_interaction", status: "pending" },
      { action_type: "af_team_interaction", status: "in_progress" },
      { action_type: "af_team_interaction", status: "completed" },
      { action_type: "principal_interaction", status: "pending" },
      { action_type: "principal_interaction", status: "in_progress" },
      { action_type: "group_student_discussion", status: "pending" },
    ]);

    expect(rollup.af_team_interaction).toBe("completed");
    expect(rollup.principal_interaction).toBe("in_progress");
    expect(rollup.group_student_discussion).toBe("pending");
  });
});

function makeRollup(
  overrides: Partial<Record<ActionType, ActionTypeRollupStatus>>
): Record<ActionType, ActionTypeRollupStatus> {
  return Object.fromEntries(
    ACTION_TYPE_VALUES.map((actionType) => [actionType, overrides[actionType] || "not_started"])
  ) as Record<ActionType, ActionTypeRollupStatus>;
}

describe("classifyActionCompletion", () => {
  it("classifies all action completion buckets and boundaries", () => {
    expect(classifyActionCompletion(makeRollup({}))).toBe("none");

    expect(classifyActionCompletion(makeRollup({
      classroom_observation: "completed",
      af_team_interaction: "completed",
      individual_af_teacher_interaction: "completed",
      principal_interaction: "completed",
      group_student_discussion: "completed",
      individual_student_discussion: "completed",
    }))).toBe("partial");

    expect(classifyActionCompletion(makeRollup({
      classroom_observation: "completed",
      af_team_interaction: "completed",
      individual_af_teacher_interaction: "completed",
      principal_interaction: "completed",
      group_student_discussion: "completed",
      individual_student_discussion: "completed",
      school_staff_interaction: "pending",
    }))).toBe("all_present");

    expect(classifyActionCompletion(makeRollup({
      classroom_observation: "completed",
      af_team_interaction: "completed",
      individual_af_teacher_interaction: "completed",
      principal_interaction: "completed",
      group_student_discussion: "completed",
      individual_student_discussion: "completed",
      school_staff_interaction: "completed",
    }))).toBe("all_complete");
  });
});

describe("computeAverageCompletion", () => {
  it("returns null for zero visits, zero for no completions, and percentages otherwise", () => {
    expect(computeAverageCompletion(0, 0)).toBeNull();
    expect(computeAverageCompletion(0, 3)).toBe(0);
    expect(computeAverageCompletion(7, 1)).toBe(100);
    expect(computeAverageCompletion(7, 2)).toBe(50);
  });
});

describe("resolvePresetDateRange", () => {
  it("resolves all date presets relative to the provided IST day", () => {
    expect(resolvePresetDateRange("1d", "2026-05-22")).toEqual({
      from: "2026-05-22",
      to: "2026-05-22",
    });
    expect(resolvePresetDateRange("7d", "2026-05-22")).toEqual({
      from: "2026-05-16",
      to: "2026-05-22",
    });
    expect(resolvePresetDateRange("30d", "2026-05-22")).toEqual({
      from: "2026-04-23",
      to: "2026-05-22",
    });
    expect(resolvePresetDateRange("90d", "2026-05-22")).toEqual({
      from: "2026-02-22",
      to: "2026-05-22",
    });
    expect(resolvePresetDateRange("1y", "2026-05-22")).toEqual({
      from: "2025-05-23",
      to: "2026-05-22",
    });
    expect(resolvePresetDateRange("all", "2026-05-22")).toBeNull();
  });

  it("uses Asia/Kolkata when a Date is provided", () => {
    expect(resolvePresetDateRange("1d", new Date("2026-05-21T20:00:00.000Z"))).toEqual({
      from: "2026-05-22",
      to: "2026-05-22",
    });
  });
});

describe("RemarkEntry", () => {
  it("exports the shared remark shape for action modules", () => {
    const remark: RemarkEntry = { label: "Question", text: "Follow up required" };

    expect(remark).toEqual({ label: "Question", text: "Follow up required" });
  });
});
