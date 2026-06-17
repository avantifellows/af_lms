import { describe, expect, it } from "vitest";

import { ACTION_TYPE_VALUES, type ActionType } from "./visit-actions";
import {
  classifyActionCompletion,
  computeAverageCompletion,
  dispatchComputeInlineStats,
  dispatchExtractRemarks,
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

describe("summary action dispatch", () => {
  it("delegates known action types and handles unknown types gracefully", () => {
    expect(
      dispatchExtractRemarks("principal_interaction", {
        additional_notes: "Bring district schedule next visit",
        questions: {
          oh_program_feedback: { answer: true, remark: "Principal wants monthly updates" },
        },
      })
    ).toEqual([
      {
        label: "Does the Principal have any feedback or concerns on the program implementation?",
        text: "Principal wants monthly updates",
      },
      {
        label: "Additional Notes or Concerns",
        text: "Bring district schedule next visit",
      },
    ]);

    expect(
      dispatchComputeInlineStats("principal_interaction", {
        questions: {
          oh_program_feedback: { answer: true },
          ip_curriculum_progress: { answer: null },
        },
      })
    ).toEqual({ answeredCount: 1, totalQuestions: 7 });

    expect(dispatchExtractRemarks("unknown_action", {})).toEqual([]);
    expect(dispatchExtractRemarks("unknown_action", {
      additional_notes: "Unclassified follow-up",
    })).toEqual([
      {
        label: "Additional Notes or Concerns",
        text: "Unclassified follow-up",
      },
    ]);
    expect(dispatchComputeInlineStats("unknown_action", {})).toBeNull();
  });

  it("dispatches all known action types to their summary extractors", () => {
    expect(dispatchComputeInlineStats("classroom_observation", {
      params: { teacher_on_time: { score: 1, remarks: "On time" } },
    })).toMatchObject({ totalScore: 1, maxScore: 45, remarkCount: 1 });

    expect(dispatchComputeInlineStats("af_team_interaction", {
      teachers: [{ id: 1, name: "Alice" }],
      questions: { op_class_duration: { answer: true } },
    })).toEqual({ answeredCount: 1, totalQuestions: 9, teacherCount: 1 });

    expect(dispatchComputeInlineStats("individual_af_teacher_interaction", {
      teachers: [{
        id: 1,
        name: "Alice",
        attendance: "present",
        questions: { oh_class_duration: { answer: true } },
      }],
    })).toEqual({
      teacherCount: 1,
      presentCount: 1,
      onLeaveCount: 0,
      absentCount: 0,
      avgAnswered: 1,
      totalQuestions: 13,
    });

    expect(dispatchComputeInlineStats("group_student_discussion", {
      grade: 11,
      questions: { gc_interacted: { answer: true } },
    })).toEqual({ grade: 11, answeredCount: 1, totalQuestions: 4 });

    expect(dispatchComputeInlineStats("individual_student_discussion", {
      entries: [{
        id: "entry-1",
        grade: 11,
        students: [{ id: 1, name: "Alice" }],
        questions: { oh_teaching_concern: { answer: true } },
      }],
    })).toEqual({ entryCount: 1, studentCount: 1, avgAnswered: 1, totalQuestions: 2 });

    expect(dispatchComputeInlineStats("school_staff_interaction", {
      questions: { gc_staff_concern: { answer: true } },
    })).toEqual({ answeredCount: 1, totalQuestions: 2 });
  });
});
