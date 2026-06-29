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
  // Placeholder for a teacher seated at a centre before their subject is known
  // (auto-assigned from school+program). Ops edits it to the real subject.
  "subject_tbd",
] as const;

/** Program-management seat tiers (vs subject-teaching seats). */
export const PM_SEAT_ROLES = ["apm", "pm", "spm", "ph"] as const;

/**
 * Seat roles that name a teaching subject. These line up name-for-name
 * (case-insensitively) with rows in the `subject` table, so seating a teacher
 * with one of these is how Ops sets their subject — the value is mirrored onto
 * `teacher.subject_id`, which is what the roster Subject column reads.
 * `subject_tbd`, `apc`, and the PM tiers are NOT subjects.
 */
export const SUBJECT_SEAT_ROLES = [
  "physics",
  "chemistry",
  "maths",
  "biology",
] as const;

export type SeatRole = (typeof SEAT_ROLES)[number];

export function isSeatRole(value: unknown): value is SeatRole {
  return typeof value === "string" && SEAT_ROLES.includes(value as SeatRole);
}

export function isSubjectSeatRole(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (SUBJECT_SEAT_ROLES as readonly string[]).includes(value)
  );
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
