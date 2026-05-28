import { ACTION_TYPE_VALUES, isActionType, type ActionType } from "./visit-actions";
import {
  computeInlineStats as computeAFTeamInlineStats,
  extractRemarks as extractAFTeamRemarks,
} from "./af-team-interaction";
import {
  computeInlineStats as computeClassroomInlineStats,
  extractRemarks as extractClassroomRemarks,
} from "./classroom-observation-rubric";
import {
  computeInlineStats as computeGroupStudentInlineStats,
  extractRemarks as extractGroupStudentRemarks,
} from "./group-student-discussion";
import {
  computeInlineStats as computeIndividualTeacherInlineStats,
  extractRemarks as extractIndividualTeacherRemarks,
} from "./individual-af-teacher-interaction";
import {
  computeInlineStats as computeIndividualStudentInlineStats,
  extractRemarks as extractIndividualStudentRemarks,
} from "./individual-student-discussion";
import {
  computeInlineStats as computePrincipalInlineStats,
  extractRemarks as extractPrincipalRemarks,
} from "./principal-interaction";
import {
  computeInlineStats as computeSchoolStaffInlineStats,
  extractRemarks as extractSchoolStaffRemarks,
} from "./school-staff-interaction";

export type RemarkEntry = { label: string; text: string };

export type ActionTypeRollupStatus = "completed" | "in_progress" | "pending" | "not_started";
export type ActionCompletionBucket = "none" | "partial" | "all_present" | "all_complete";
export type DateRangePreset = "1d" | "7d" | "30d" | "90d" | "1y" | "all";

const STATUS_RANK: Record<ActionTypeRollupStatus, number> = {
  not_started: 0,
  pending: 1,
  in_progress: 2,
  completed: 3,
};

const PRESET_DAYS: Record<Exclude<DateRangePreset, "all">, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

export function rollupActionTypes(
  actions: Array<{ action_type: string; status: string }>
): Record<ActionType, ActionTypeRollupStatus> {
  const rollup = Object.fromEntries(
    ACTION_TYPE_VALUES.map((actionType) => [actionType, "not_started"])
  ) as Record<ActionType, ActionTypeRollupStatus>;

  for (const action of actions) {
    if (!isActionType(action.action_type)) {
      continue;
    }

    if (!isRollupStatus(action.status)) {
      continue;
    }

    if (STATUS_RANK[action.status] > STATUS_RANK[rollup[action.action_type]]) {
      rollup[action.action_type] = action.status;
    }
  }

  return rollup;
}

export function classifyActionCompletion(
  rollup: Record<ActionType, ActionTypeRollupStatus>
): ActionCompletionBucket {
  const touchedCount = ACTION_TYPE_VALUES.filter(
    (actionType) => rollup[actionType] !== "not_started"
  ).length;
  const completedCount = ACTION_TYPE_VALUES.filter(
    (actionType) => rollup[actionType] === "completed"
  ).length;

  if (completedCount === ACTION_TYPE_VALUES.length) {
    return "all_complete";
  }
  if (touchedCount === 0) {
    return "none";
  }
  if (touchedCount === ACTION_TYPE_VALUES.length) {
    return "all_present";
  }
  return "partial";
}

export function computeAverageCompletion(
  completedTypeCountSum: number,
  visitCount: number,
  knownTypeCount = ACTION_TYPE_VALUES.length
): number | null {
  if (visitCount === 0) {
    return null;
  }
  return (completedTypeCountSum / (visitCount * knownTypeCount)) * 100;
}

export function resolvePresetDateRange(
  preset: string | undefined,
  today: Date | string
): { from: string; to: string } | null {
  if (!isDateRangePreset(preset) || preset === "all") {
    return null;
  }

  const to = toIstDateString(today);
  const from = addDays(to, -(PRESET_DAYS[preset] - 1));

  return { from, to };
}

export function dispatchExtractRemarks(actionType: string, data: unknown): RemarkEntry[] {
  switch (actionType) {
    case "classroom_observation":
      return extractClassroomRemarks(data);
    case "af_team_interaction":
      return extractAFTeamRemarks(data);
    case "individual_af_teacher_interaction":
      return extractIndividualTeacherRemarks(data);
    case "principal_interaction":
      return extractPrincipalRemarks(data);
    case "group_student_discussion":
      return extractGroupStudentRemarks(data);
    case "individual_student_discussion":
      return extractIndividualStudentRemarks(data);
    case "school_staff_interaction":
      return extractSchoolStaffRemarks(data);
    default:
      return [];
  }
}

export function dispatchComputeInlineStats(actionType: string, data: unknown): unknown {
  switch (actionType) {
    case "classroom_observation":
      return computeClassroomInlineStats(data);
    case "af_team_interaction":
      return computeAFTeamInlineStats(data);
    case "individual_af_teacher_interaction":
      return computeIndividualTeacherInlineStats(data);
    case "principal_interaction":
      return computePrincipalInlineStats(data);
    case "group_student_discussion":
      return computeGroupStudentInlineStats(data);
    case "individual_student_discussion":
      return computeIndividualStudentInlineStats(data);
    case "school_staff_interaction":
      return computeSchoolStaffInlineStats(data);
    default:
      return null;
  }
}

function isRollupStatus(value: string): value is ActionTypeRollupStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

function isDateRangePreset(value: string | undefined): value is DateRangePreset {
  return value === "1d" || value === "7d" || value === "30d" || value === "90d" || value === "1y" || value === "all";
}

function toIstDateString(value: Date | string): string {
  if (typeof value === "string") {
    return value;
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${partMap.year}-${partMap.month}-${partMap.day}`;
}

function addDays(yyyyMmDd: string, days: number): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return date.toISOString().slice(0, 10);
}
