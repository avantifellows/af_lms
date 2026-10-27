import { describe, expect, it } from "vitest";

import { ACTION_TYPE_VALUES, type ActionType } from "./visit-actions";
import {
  classifyActionCompletion,
  computeAverageCompletion,
  concernSeverity,
  dispatchComputeInlineStats,
  dispatchExtractRemarks,
  formatCompactVisitDates,
  formatIstDate,
  formatIstTimestamp,
  formatVisitCount,
  resolvePresetDateRange,
  rollupActionTypes,
  searchParamsWithout,
  visitSummaryBackHref,
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
    }))).toBe("partial");

    expect(classifyActionCompletion(makeRollup({
      classroom_observation: "completed",
      af_team_interaction: "completed",
      individual_af_teacher_interaction: "completed",
      principal_interaction: "completed",
      group_student_discussion: "completed",
      individual_student_discussion: "pending",
      school_staff_interaction: "pending",
    }))).toBe("all_present");

    expect(classifyActionCompletion(makeRollup({
      classroom_observation: "completed",
      af_team_interaction: "completed",
      individual_af_teacher_interaction: "completed",
      principal_interaction: "completed",
      group_student_discussion: "completed",
      individual_student_discussion: "completed",
    }))).toBe("all_complete");
  });
});

describe("computeAverageCompletion", () => {
  it("returns null for zero visits, zero for no completions, and percentages otherwise", () => {
    expect(computeAverageCompletion(0, 0)).toBeNull();
    expect(computeAverageCompletion(0, 3)).toBe(0);
    expect(computeAverageCompletion(6, 1)).toBe(100);
    expect(computeAverageCompletion(6, 2)).toBe(50);
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

describe("concernSeverity", () => {
  it("grades a School by its Recurring and open Visit Concerns", () => {
    expect(concernSeverity({ recurringCount: 4, openCount: 6 })).toBe("high");
    expect(concernSeverity({ recurringCount: 3, openCount: 3 })).toBe("high");
    expect(concernSeverity({ recurringCount: 2, openCount: 5 })).toBe("medium");
    expect(concernSeverity({ recurringCount: 1, openCount: 1 })).toBe("medium");
    expect(concernSeverity({ recurringCount: 0, openCount: 1 })).toBe("low");
    expect(concernSeverity({ recurringCount: 0, openCount: 0 })).toBe("none");
  });
});

describe("formatCompactVisitDates", () => {
  // 27 Oct 2026, 10:00 IST.
  const today = new Date("2026-10-27T04:30:00Z");

  it("lists Visit dates newest first and groups same-day Visits as ×n, without the current IST year", () => {
    expect(formatCompactVisitDates(["2026-06-10", "2026-08-06", "2026-09-15", "2026-08-06"], today)).toBe(
      "15 Sep · 06 Aug ×2 · 10 Jun"
    );
  });

  it("shows the year on dates outside the current IST year", () => {
    expect(formatCompactVisitDates(["2025-12-20", "2026-01-05", "2025-12-20"], today)).toBe(
      "05 Jan · 20 Dec 2025 ×2"
    );
  });

  it("takes the current year from the IST date: 31 Dec 2025 20:00 UTC is already 2026 in IST", () => {
    expect(formatCompactVisitDates(["2026-01-01", "2025-12-31"], new Date("2025-12-31T20:00:00Z"))).toBe(
      "01 Jan · 31 Dec 2025"
    );
  });
});

describe("IST formatters", () => {
  it("formats a Visit date or a timestamp as its IST date", () => {
    expect(formatIstDate("2026-10-15")).toBe("15 Oct 2026");
    // 31 Dec 2025 20:00 UTC is already 1 Jan 2026 in IST.
    expect(formatIstDate(new Date("2025-12-31T20:00:00Z"))).toBe("01 Jan 2026");
  });

  it("formats a timestamp in IST on a 24-hour clock, and a missing one as -", () => {
    expect(formatIstTimestamp(new Date("2026-10-20T08:30:00Z"))).toBe("20 Oct 2026, 14:00");
    expect(formatIstTimestamp("2026-10-20T18:45:00Z")).toBe("21 Oct 2026, 00:15");
    expect(formatIstTimestamp(null)).toBe("-");
  });

  it("counts Visits in the singular only for one", () => {
    expect(formatVisitCount(0)).toBe("0 visits");
    expect(formatVisitCount(1)).toBe("1 visit");
    expect(formatVisitCount(3)).toBe("3 visits");
  });
});

describe("searchParamsWithout", () => {
  const current = { tab: "schools", regions: "Bhopal", sort: "visits", dir: "asc", page: "2", pms: "", schools: undefined };

  it("copies every non-empty param except the omitted keys, in order", () => {
    expect(searchParamsWithout(current, ["sort", "dir", "page"]).toString()).toBe("tab=schools&regions=Bhopal");
    expect(searchParamsWithout(current, []).toString()).toBe("tab=schools&regions=Bhopal&sort=visits&dir=asc&page=2");
  });

  it("starts from the initial params, which an omitted key in the current params can't overwrite", () => {
    expect(searchParamsWithout(current, ["tab", "sort", "dir", "page"], { tab: "visits" }).toString()).toBe(
      "tab=visits&regions=Bhopal"
    );
  });
});

describe("visitSummaryBackHref", () => {
  it("keeps a Visit Summary list or School page, with its query", () => {
    for (const href of [
      "/school-visit-summary",
      "/school-visit-summary?tab=schools&regions=Bhopal",
      "/school-visit-summary/schools/SC001",
      "/school-visit-summary/schools/SC001?preset=30d&sort=visits",
    ]) {
      expect(visitSummaryBackHref(href)).toBe(href);
    }
  });

  it("falls back to the Visits tab for anything else", () => {
    for (const back of [
      undefined,
      "",
      ["/school-visit-summary"],
      "https://evil.example/school-visit-summary",
      "//evil.example/school-visit-summary",
      "/\\evil.example",
      "/dashboard",
      "/school-visit-summaryx",
      "/school-visit-summary/123",
      "/school-visit-summary/schools/SC001/extra",
      "/school-visit-summary/schools/SC001#top",
      "school-visit-summary",
    ]) {
      expect(visitSummaryBackHref(back)).toBe("/school-visit-summary?tab=visits");
    }
  });
});
