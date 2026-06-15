/**
 * Client-safe staff types and constants. No DB imports — this module is
 * bundled into client components (StaffGrid); server-only logic lives in
 * staff-admin.ts, which re-exports these.
 */

export const SEAT_ROLES = [
  "physics",
  "chemistry",
  "maths",
  "biology",
  "apc",
  "pm",
  "apm",
  "spm",
  "ph",
] as const;

/** Program-management seat tiers (vs subject-teaching seats). */
export const PM_SEAT_ROLES = ["apm", "pm", "spm", "ph"] as const;

export type SeatRole = (typeof SEAT_ROLES)[number];

export function isSeatRole(value: unknown): value is SeatRole {
  return typeof value === "string" && SEAT_ROLES.includes(value as SeatRole);
}

export const EMPLOYEE_CODE_PATTERN = /^AF\d+$/;

export function normalizeEmployeeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return EMPLOYEE_CODE_PATTERN.test(code) ? code : null;
}

export type RosterKind = "teacher" | "staff" | "pending_teacher" | "pending_pm";
export type RosterKindFilter = "all" | RosterKind;
export type RosterCodeFilter = "all" | "missing" | "present";
export type RosterExitedFilter = "exclude" | "include";

export interface StaffRosterFilters {
  search: string;
  kind: RosterKindFilter;
  code: RosterCodeFilter;
  exited: RosterExitedFilter;
  centreId: number | null;
}

export interface RosterSeat {
  id: number;
  centreId: number;
  centreName: string;
  role: SeatRole;
}

export interface StaffRosterRow {
  kind: RosterKind;
  recordId: number;
  userId: number | null;
  name: string;
  email: string | null;
  employeeCode: string | null;
  subjectName: string | null;
  staffType: string | null;
  designation: string | null;
  exitDate: string | null;
  seats: RosterSeat[];
}

export interface StaffRosterSummary {
  total: number;
  teachers: number;
  staff: number;
  pending: number;
  missingCode: number;
  exited: number;
  vacantSeats: number;
}
