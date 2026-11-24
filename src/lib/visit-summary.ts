import {
  ACTION_TYPE_VALUES,
  REQUIRED_ACTION_TYPE_VALUES,
  isActionType,
  type ActionType,
} from "./visit-actions";
import {
  ACTION_ADDITIONAL_NOTES_LABEL,
  readActionAdditionalNotes,
} from "./visit-form-utils";
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
type DateRangePreset = "1d" | "7d" | "30d" | "90d" | "1y" | "all";

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
  const touchedCount = REQUIRED_ACTION_TYPE_VALUES.filter(
    (actionType) => rollup[actionType] !== "not_started"
  ).length;
  const completedCount = REQUIRED_ACTION_TYPE_VALUES.filter(
    (actionType) => rollup[actionType] === "completed"
  ).length;

  if (completedCount === REQUIRED_ACTION_TYPE_VALUES.length) {
    return "all_complete";
  }
  if (touchedCount === 0) {
    return "none";
  }
  if (touchedCount === REQUIRED_ACTION_TYPE_VALUES.length) {
    return "all_present";
  }
  return "partial";
}

export function computeAverageCompletion(
  completedTypeCountSum: number,
  visitCount: number,
  knownTypeCount = REQUIRED_ACTION_TYPE_VALUES.length
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

// A School's last visit is stale when it is more than this many days before today in IST.
export const STALE_LAST_VISIT_DAYS = 45;

export function isStaleLastVisit(lastVisitDate: string, today: Date | string): boolean {
  return lastVisitDate < addDays(toIstDateString(today), -STALE_LAST_VISIT_DAYS);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The Visit dates of a concern card, newest first: `15 Sep · 06 Aug ×2 · 10 Jun`. Same-day Visits
// collapse into one date with ×n; the year shows only when it isn't the current IST year.
export function formatCompactVisitDates(visitDates: string[], today: Date | string): string {
  const currentYear = toIstDateString(today).slice(0, 4);
  const counts = new Map<string, number>();
  for (const date of visitDates) {
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, count]) => {
      const [year, month, day] = date.split("-");
      const label = `${day} ${SHORT_MONTHS[Number(month) - 1]}${year === currentYear ? "" : ` ${year}`}`;
      return count > 1 ? `${label} ×${count}` : label;
    })
    .join(" · ");
}

// `15 Oct 2026`, the IST date of a `YYYY-MM-DD` Visit date or a timestamp.
export function formatIstDate(value: string | Date): string {
  const { day, month, year } = istDateTimeParts(value);
  return `${day} ${month} ${year}`;
}

// `15 Oct 2026, 14:00` in IST (24-hour); `-` when there is no timestamp.
export function formatIstTimestamp(value: string | Date | null): string {
  if (!value) {
    return "-";
  }

  const { day, month, year, hour, minute } = istDateTimeParts(value);
  return `${day} ${month} ${year}, ${hour}:${minute}`;
}

// The IST parts of a date, with the month from SHORT_MONTHS so every Visit Summary date reads
// `Sep` (the en-IN locale would print `Sept`).
function istDateTimeParts(value: string | Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value])
  );

  return {
    day: parts.day,
    month: SHORT_MONTHS[Number(parts.month) - 1],
    year: parts.year,
    hour: parts.hour,
    minute: parts.minute,
  };
}

export function formatVisitCount(count: number): string {
  return `${count} visit${count === 1 ? "" : "s"}`;
}

// A Visit Concern is Recurring when it has live mentions on at least this many distinct visit dates
// in view: Visits on the same day (two PMs at the School that day) count once. The counts shown
// beside it are still Visits ("Recurring · 3 visits"). The School-wise counts (SQL), the School
// page's "Recurring ·" label and its header chip all read it.
export const RECURRING_CONCERN_MIN_DAYS = 2;

// The current search params as URLSearchParams, starting from `initial` and leaving out empty
// values and every key in `omit` (the Visit Summary's tab, sort and page links).
export function searchParamsWithout(
  current: Record<string, string | undefined>,
  omit: readonly string[],
  initial: Record<string, string> = {}
): URLSearchParams {
  const params = new URLSearchParams(initial);
  for (const [key, value] of Object.entries(current)) {
    if (value && !omit.includes(key)) {
      params.set(key, value);
    }
  }
  return params;
}

const VISIT_SUMMARY_VISITS_TAB_HREF = "/school-visit-summary?tab=visits";

// The Visit Summary list or one of its School pages, with an optional query; nothing else.
const VISIT_SUMMARY_BACK_HREF = /^\/school-visit-summary(?:\/schools\/[^/?#\\]+)?(?:\?[^#\\]*)?$/;

// Where a Visit's detail page goes Back to: `back` when it is a Visit Summary list or School page
// (so it can't send the viewer off-site or elsewhere in the app), else the Visits tab.
export function visitSummaryBackHref(back: unknown): string {
  return typeof back === "string" && VISIT_SUMMARY_BACK_HREF.test(back) ? back : VISIT_SUMMARY_VISITS_TAB_HREF;
}

// The severity marker beside a School on the School-wise tab: 3+ Recurring Concerns, 1–2,
// open Concerns but none recurring, or nothing open (counts over the Visits in view).
export type ConcernSeverity = "high" | "medium" | "low" | "none";

export function concernSeverity({ recurringCount, openCount }: { recurringCount: number; openCount: number }): ConcernSeverity {
  if (recurringCount >= 3) {
    return "high";
  }
  if (recurringCount > 0) {
    return "medium";
  }
  return openCount > 0 ? "low" : "none";
}

export function dispatchExtractRemarks(actionType: string, data: unknown): RemarkEntry[] {
  const additionalNotes = readActionAdditionalNotes(data).trim();
  const actionNotes = additionalNotes
    ? [{ label: ACTION_ADDITIONAL_NOTES_LABEL, text: additionalNotes }]
    : [];

  switch (actionType) {
    case "classroom_observation":
      return [...extractClassroomRemarks(data), ...actionNotes];
    case "af_team_interaction":
      return [...extractAFTeamRemarks(data), ...actionNotes];
    case "individual_af_teacher_interaction":
      return [...extractIndividualTeacherRemarks(data), ...actionNotes];
    case "principal_interaction":
      return [...extractPrincipalRemarks(data), ...actionNotes];
    case "group_student_discussion":
      return [...extractGroupStudentRemarks(data), ...actionNotes];
    case "individual_student_discussion":
      return [...extractIndividualStudentRemarks(data), ...actionNotes];
    case "school_staff_interaction":
      return [...extractSchoolStaffRemarks(data), ...actionNotes];
    default:
      return actionNotes;
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
