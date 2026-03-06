export const ACTION_TYPES = {
  principal_meeting: "Principal Meeting",
  leadership_meeting: "Leadership Meeting",
  classroom_observation: "Classroom Observation",
  group_student_discussion: "Group Student Discussion",
  individual_student_discussion: "Individual Student Discussion",
  individual_staff_meeting: "Individual Staff Meeting",
  team_staff_meeting: "Team Staff Meeting",
  teacher_feedback: "Teacher Feedback",
} as const;

export type ActionType = keyof typeof ACTION_TYPES;

export const ACTION_TYPE_VALUES = Object.keys(ACTION_TYPES) as ActionType[];

export const ACTION_STATUS_VALUES = ["pending", "in_progress", "completed"] as const;
export type ActionStatus = (typeof ACTION_STATUS_VALUES)[number];

export function isActionType(value: string): value is ActionType {
  return value in ACTION_TYPES;
}

export function getActionTypeLabel(actionType: ActionType): string {
  return ACTION_TYPES[actionType];
}

export function statusBadgeClass(status: string): string {
  const base = "rounded-full px-2.5 py-0.5 text-xs font-medium";
  if (status === "completed") {
    return `${base} bg-success-bg text-accent-hover`;
  }
  if (status === "in_progress") {
    return `${base} bg-warning-bg text-warning-text`;
  }
  if (status === "pending") {
    return `${base} bg-bg-card-alt text-text-secondary`;
  }
  return `${base} bg-bg-card-alt text-text-muted`;
}
