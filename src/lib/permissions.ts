import { query } from "./db";
import {
  PHYSICAL_CENTRE_PROGRAM_IDS,
  PROGRAM_IDS,
  PROGRAM_IDS_ORDERED,
  PROGRAM_ID_TO_LABEL,
} from "./constants";

// Re-exported from constants so existing `@/lib/permissions` imports keep
// working while the definitions live in a client-safe module.
export { PHYSICAL_CENTRE_PROGRAM_IDS, PROGRAM_IDS, PROGRAM_IDS_ORDERED, PROGRAM_ID_TO_LABEL };

// Permission levels (school scope only)
export type AccessLevel = 1 | 2 | 3;
// 1 = Single school access
// 2 = Region access (all schools in a region)
// 3 = All schools access

// User roles
export type UserRole =
  | "teacher"
  | "program_manager"
  | "program_admin"
  | "holistic_mentorship_admin"
  | "admin";

// Feature types for permission checking
export type Feature =
  | "students"
  | "visits"
  | "curriculum"
  | "academic_mentorship"
  | "holistic_mentorship"
  | "performance"
  | "summary_stats"
  | "pm_dashboard"
  | "quiz_sessions";

// Feature access levels
export type FeatureAccess = "none" | "view" | "edit";

// Feature permission matrix: feature → role → access level
const FEATURE_PERMISSIONS: Record<Feature, Record<UserRole, FeatureAccess>> = {
  students: { teacher: "edit", program_manager: "edit", program_admin: "edit", holistic_mentorship_admin: "none", admin: "edit" },
  visits: { teacher: "none", program_manager: "edit", program_admin: "edit", holistic_mentorship_admin: "none", admin: "edit" },
  curriculum: { teacher: "edit", program_manager: "view", program_admin: "edit", holistic_mentorship_admin: "none", admin: "edit" },
  academic_mentorship: { teacher: "view", program_manager: "view", program_admin: "edit", holistic_mentorship_admin: "none", admin: "edit" },
  holistic_mentorship: { teacher: "edit", program_manager: "none", program_admin: "none", holistic_mentorship_admin: "edit", admin: "edit" },
  performance: { teacher: "view", program_manager: "view", program_admin: "view", holistic_mentorship_admin: "none", admin: "view" },
  summary_stats: { teacher: "none", program_manager: "view", program_admin: "view", holistic_mentorship_admin: "none", admin: "view" },
  pm_dashboard: { teacher: "none", program_manager: "view", program_admin: "view", holistic_mentorship_admin: "none", admin: "view" },
  quiz_sessions: { teacher: "edit", program_manager: "view", program_admin: "view", holistic_mentorship_admin: "none", admin: "view" },
};

// Features gated to CoE/Nodal programs only (NVS-only users get "none")
const NVS_GATED_FEATURES: Set<Feature> = new Set([
  "visits", "curriculum", "pm_dashboard", "summary_stats", "quiz_sessions",
]);

export interface FeatureAccessResult {
  access: FeatureAccess;
  canView: boolean;
  canEdit: boolean;
}

interface FeatureAccessOptions {
  isPasscodeUser?: boolean;
}

/**
 * Get the feature access level for a user.
 * Handles passcode users, NVS-only gating, and read_only downgrade.
 */
export function getFeatureAccess(
  permission: UserPermission | null,
  feature: Feature,
  opts?: FeatureAccessOptions,
): FeatureAccessResult {
  const none: FeatureAccessResult = { access: "none", canView: false, canEdit: false };

  // Passcode users: students → edit, everything else → none
  if (opts?.isPasscodeUser) {
    if (feature === "students") {
      return { access: "edit", canView: true, canEdit: true };
    }
    return none;
  }

  if (!permission) return none;

  // Look up base access from matrix
  let access = FEATURE_PERMISSIONS[feature]?.[permission.role] ?? "none";

  // NVS-only gating: force "none" for gated features if user lacks CoE/Nodal
  if (access !== "none" && NVS_GATED_FEATURES.has(feature)) {
    const context = getProgramContextSync(permission);
    if (!context.hasCoEOrNodal) {
      access = "none";
    }
  }

  // read_only downgrade: "edit" → "view"
  if (access === "edit" && permission.read_only) {
    access = "view";
  }

  return {
    access,
    canView: access !== "none",
    canEdit: access === "edit",
  };
}

/**
 * Check if a user owns a record (for per-row edit gating).
 * Returns true if the user's program_ids include the record's program_id.
 */
export function ownsRecord(
  permission: UserPermission | null,
  programId: number | null,
  opts?: { isPasscodeUser?: boolean },
): boolean {
  // Passcode users own all records at their school
  if (opts?.isPasscodeUser) return true;
  if (!permission) return false;
  // Admins own everything
  if (permission.role === "admin") return true;
  // Unassigned records are editable by anyone with feature-level edit
  if (programId === null) return true;
  // Check program_ids
  if (!permission.program_ids || permission.program_ids.length === 0) return false;
  return permission.program_ids.includes(programId);
}

export interface UserPermission {
  email: string;
  level: AccessLevel;
  role: UserRole;
  school_codes?: string[] | null;
  regions?: string[] | null;
  program_ids?: number[] | null;
  read_only?: boolean;
  // db-service `user` PK (user_permission.user_id, live prod + staging via #545).
  // Carried so the scope resolver can find this person's centre seats without a
  // second email→user lookup. Selected in getUserPermission (single column, no
  // join — the hot path stays lean).
  user_id?: number | null;
  // Effective school/centre scope, populated only by getResolvedPermission /
  // resolveScope (NOT by getUserPermission). When present, canAccessSchoolSync
  // grants seat-derived schools on top of the level switch. Absent on a bare
  // getUserPermission result, which behaves exactly as before.
  scope?: ResolvedScope;
}

// Effective, DB-resolved access scope. `schools` is the union of explicit
// school_codes/regions and centre-seat-derived schools; `centres` is the set of
// centres the person holds a seat at. "all" short-circuits for level-3 admins.
export interface ResolvedScope {
  schools: Set<string> | "all";
  centres: Set<number> | "all";
  // Programs reachable via the person's centre seats (each centre belongs to
  // exactly one program). Unioned with explicit program_ids by
  // getProgramContextSync, so a seated user is never locked out of the program
  // their seat implies even when program_ids is empty. "all" for level-3 admins.
  programs: Set<number> | "all";
}

// Program permission context
export interface ProgramPermissionContext {
  hasAccess: boolean;
  programIds: number[];
  isNVSOnly: boolean;
  hasCoEOrNodal: boolean;
}

interface SchoolPasscode {
  schoolCode: string;
  passcode: string; // 8 digits
}

// School passcodes - 8 digit codes for schools without Google
// Format: schoolCode -> passcode
const SCHOOL_PASSCODES: SchoolPasscode[] = [
  { schoolCode: "70705", passcode: "70705123" }, // JNV Bhavnagar
  { schoolCode: "14042", passcode: "14042456" },
  // Add more schools as needed
];

export async function getUserPermission(
  email: string
): Promise<UserPermission | null> {
  // `revoked_at IS NULL` is the single enforcement point for "marked exited":
  // a revoked person resolves to no permissions everywhere this is called —
  // login lands on pages that gate on it, isAdmin, canAccessSchool, the admin
  // guards.
  const results = await query<{
    email: string;
    level: number;
    role: string;
    school_codes: string[] | null;
    regions: string[] | null;
    program_ids: number[] | null;
    read_only: boolean;
    user_id: number | string | null;
  }>(
    `SELECT email, level, role, school_codes, regions, program_ids, read_only, user_id
     FROM user_permission
     WHERE LOWER(email) = LOWER($1) AND revoked_at IS NULL`,
    [email]
  );

  if (results.length === 0) return null;

  const row = results[0];
  return {
    email: row.email,
    level: row.level as AccessLevel,
    role: (row.role || "teacher") as UserRole,
    school_codes: row.school_codes,
    regions: row.regions,
    program_ids: row.program_ids,
    read_only: row.read_only,
    user_id: row.user_id == null ? null : Number(row.user_id),
  };
}

// Centre ids the user holds an active seat at (centre_positions.user_id).
async function centresForUser(userId: number): Promise<number[]> {
  const rows = await query<{ centre_id: number | string }>(
    `SELECT DISTINCT centre_id
     FROM centre_positions
     WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  return rows.map((r) => Number(r.centre_id));
}

// School codes for a set of centres (centres.school_id → school.code). Returns
// [] for empty input rather than issuing a `= ANY('{}')` query.
async function schoolCodesForCentres(centreIds: number[]): Promise<string[]> {
  if (centreIds.length === 0) return [];
  const rows = await query<{ code: string }>(
    `SELECT DISTINCT s.code
     FROM centres c
     JOIN school s ON s.id = c.school_id
     WHERE c.id = ANY($1) AND c.school_id IS NOT NULL`,
    [centreIds]
  );
  return rows.map((r) => r.code);
}

// Program ids for a set of centres (centres.program_id). Each centre belongs to
// exactly one program, so this is the seat-derived program scope. Returns [] for
// empty input rather than issuing a `= ANY('{}')` query.
async function programsForCentres(centreIds: number[]): Promise<number[]> {
  if (centreIds.length === 0) return [];
  const rows = await query<{ program_id: number | string }>(
    `SELECT DISTINCT program_id
     FROM centres
     WHERE id = ANY($1) AND program_id IS NOT NULL`,
    [centreIds]
  );
  return rows.map((r) => Number(r.program_id));
}

// True only for Postgres "undefined_table" / "undefined_column" errors — the
// signal that the centre-seat schema hasn't been migrated on this environment
// yet. Used to scope resolveScope's degrade-to-explicit fallback to that case
// alone (transient failures must propagate, not silently empty the scope).
function isMissingSchemaError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "42703";
}

// Resolve a permission's effective scope: explicit school_codes ∪ centre-seat-
// derived schools. Regions stay handled lazily by canAccessSchoolSync's level-2
// branch (no eager region→school expansion here, so level-2 semantics are
// unchanged). The union is additive and safe today because backfilled seats were
// derived from school_codes (seat schools ⊆ school_codes); strict per-user
// exclusivity (B2) makes seats the sole source for seated staff.
export async function resolveScope(p: UserPermission): Promise<ResolvedScope> {
  if (p.level === 3) return { schools: "all", centres: "all", programs: "all" };

  // school_codes is the level-1 scope mechanism; level-2's explicit scope is
  // regions (kept lazy in canAccessSchoolSync's switch), so only seed school_codes
  // for level 1 — seeding it for level 2 would over-grant the additive check and
  // diverge from the level switch.
  const schools = new Set<string>(p.level === 1 ? p.school_codes ?? [] : []);
  const centres = new Set<number>();
  // Seat-derived programs only — explicit program_ids are unioned in by
  // getProgramContextSync, which is where program access is actually decided.
  const programs = new Set<number>();

  if (p.user_id != null) {
    try {
      const centreIds = await centresForUser(p.user_id);
      centreIds.forEach((id) => centres.add(id));
      for (const code of await schoolCodesForCentres(centreIds)) {
        schools.add(code);
      }
      for (const programId of await programsForCentres(centreIds)) {
        programs.add(programId);
      }
    } catch (err) {
      // The centre tables/columns may not exist yet on an environment that
      // hasn't run the seat migration — degrade to explicit-only scope in that
      // one case. Any other error (a transient DB failure) must propagate:
      // swallowing it would silently hand a *seated* staff member an empty
      // scope (their explicit school_codes were cleared by strict exclusivity),
      // i.e. lock them out of their own data while showing no error.
      if (!isMissingSchemaError(err)) throw err;
    }
  }

  return { schools, centres, programs };
}

// getUserPermission + resolved scope. Use this (not getUserPermission) anywhere
// school/centre access is actually decided, so canAccessSchoolSync sees seats.
export async function getResolvedPermission(
  email: string
): Promise<UserPermission | null> {
  const permission = await getUserPermission(email);
  if (!permission) return null;
  return { ...permission, scope: await resolveScope(permission) };
}

export function getSchoolByPasscode(passcode: string): string | null {
  const entry = SCHOOL_PASSCODES.find((s) => s.passcode === passcode);
  return entry?.schoolCode || null;
}

export function canAccessSchoolSync(
  permission: UserPermission | null,
  schoolCode: string,
  schoolRegion?: string
): boolean {
  if (!permission) return false;
  // Seat-derived scope (populated by getResolvedPermission) grants access
  // additively, regardless of level — a teacher seated at a centre reaches that
  // centre's school even if it isn't in their explicit school_codes. Absent
  // scope (bare getUserPermission) falls straight through to the level switch,
  // so existing callers are unaffected.
  if (
    permission.scope &&
    permission.scope.schools !== "all" &&
    permission.scope.schools.has(schoolCode)
  ) {
    return true;
  }
  switch (permission.level) {
    case 3: return true;
    case 2: return permission.regions?.includes(schoolRegion || "") || false;
    case 1: return permission.school_codes?.includes(schoolCode) || false;
    default: return false;
  }
}

// Centre-native access check for callers that hold a centre id directly. Reads
// the resolved seat set; level-3 (scope "all") reaches every centre.
export function canAccessCentreSync(
  permission: UserPermission | null,
  centreId: number
): boolean {
  if (!permission) return false;
  if (permission.scope?.centres === "all") return true;
  return permission.scope?.centres instanceof Set
    ? permission.scope.centres.has(centreId)
    : false;
}

export async function canAccessSchool(
  email: string | null,
  schoolCode: string,
  schoolRegion?: string
): Promise<boolean> {
  if (!email) return false;
  const permission = await getResolvedPermission(email);
  // For level-2 (region) users, look up the school's region if not provided
  if (permission?.level === 2 && !schoolRegion) {
    const result = await query<{ region: string }>(
      `SELECT region FROM school WHERE code = $1`,
      [schoolCode]
    );
    schoolRegion = result[0]?.region;
  }
  return canAccessSchoolSync(permission, schoolCode, schoolRegion);
}

export function hasMultipleSchools(permission: UserPermission | null): boolean {
  if (!permission) return false;
  return permission.level >= 2 ||
    (permission.school_codes !== null && (permission.school_codes?.length ?? 0) > 1) ||
    (permission.scope?.schools instanceof Set && permission.scope.schools.size > 1);
}

export async function getAccessibleSchoolCodes(
  email: string,
  existingPermission?: UserPermission | null
): Promise<string[] | "all"> {
  const permission =
    existingPermission !== undefined
      ? existingPermission
      : await getResolvedPermission(email);
  if (!permission) return [];

  if (permission.level === 3) return "all";

  // Resolved scope = explicit school_codes ∪ centre-seat schools. Resolve here
  // if the caller handed us a bare (unresolved) permission so seat schools are
  // still included.
  const scope = permission.scope ?? (await resolveScope(permission));
  if (scope.schools === "all") return "all";

  const codes = new Set<string>(scope.schools);

  // Level 2: also expand the user's assigned regions to concrete JNV codes.
  if (permission.level === 2 && permission.regions && permission.regions.length > 0) {
    const schools = await query<{ code: string }>(
      `SELECT code FROM school
       WHERE af_school_category = 'JNV'
         AND region = ANY($1)`,
      [permission.regions]
    );
    for (const s of schools) codes.add(s.code);
  }

  return [...codes];
}

export async function isAdmin(email: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  return permission?.role === "admin";
}

export interface StudentScope {
  code: string;
  region: string | null;
  /**
   * `program_id` of the student's current batch enrollment, or null if the
   * student has no current batch (unassigned). Used by `canAccessStudent`'s
   * `requireEdit` branch to enforce per-program ownership the same way the
   * UI's per-row `canEditStudent` check does — a COE-only user shouldn't be
   * able to mutate an NVS student's documents in a mixed school like JNV
   * Adilabad even when school + role checks pass.
   */
  program_id: number | null;
}

// Look up a student's school (code + region) and current program by the
// student primary key (db-service `student.id`). Returns null if the student
// doesn't exist or has no school membership.
export async function getStudentSchool(
  studentPkId: number | string,
): Promise<StudentScope | null> {
  const rows = await query<StudentScope>(
    `SELECT sch.code, sch.region, b.program_id
     FROM student s
     JOIN group_user gu_sch ON gu_sch.user_id = s.user_id
     JOIN "group" g_sch ON g_sch.id = gu_sch.group_id AND g_sch.type = 'school'
     JOIN school sch ON sch.id = g_sch.child_id
     LEFT JOIN enrollment_record er_batch
       ON er_batch.user_id = s.user_id
       AND er_batch.group_type = 'batch'
       AND er_batch.is_current = true
     LEFT JOIN batch b ON b.id = er_batch.group_id
     WHERE s.id = $1
     LIMIT 1`,
    [studentPkId],
  );
  return rows[0] ?? null;
}

// Permission gate for routes scoped to a single student. Honors both Google
// users (via canAccessSchool against their user_permission row) and passcode
// users (via session.schoolCode match).
//
// Pass `requireEdit: true` for write paths (upload, delete) — this additionally
// requires the user's role + read_only flag to grant `canEdit` on the
// `students` feature. Without it, a read_only program_admin could mutate
// student documents via direct API calls even though the UI hides the buttons.
export async function canAccessStudent(
  session: {
    user?: { email?: string | null } | null;
    isPasscodeUser?: boolean;
    schoolCode?: string;
  } | null,
  studentPkId: number | string,
  options?: { requireEdit?: boolean },
): Promise<boolean> {
  if (!session) return false;
  const school = await getStudentSchool(studentPkId);
  if (!school) return false;

  if (session.isPasscodeUser) {
    // Passcode users have edit access on `students` per getFeatureAccess; the
    // only check that matters is school match.
    return session.schoolCode === school.code;
  }

  const email = session.user?.email;
  if (!email) return false;
  const permission = await getResolvedPermission(email);
  if (!canAccessSchoolSync(permission, school.code, school.region || undefined)) {
    // Level-2 region users may still match via the async fallback path that
    // canAccessSchool does (querying school.region when not provided). We've
    // already passed region in, so the sync check is sufficient here.
    if (!permission || permission.level !== 2) return false;
    const ok = await canAccessSchool(email, school.code, school.region || undefined);
    if (!ok) return false;
  }
  if (options?.requireEdit) {
    const { canEdit } = getFeatureAccess(permission, "students");
    if (!canEdit) return false;
    // Per-program ownership — mirrors the UI's per-row canEditStudent check.
    // ownsRecord returns true for admins, true for null program_id
    // (unassigned student), and true if the user's program_ids includes the
    // student's program. Without this, a COE-only user could POST/DELETE
    // documents for an NVS student in a mixed school.
    if (!ownsRecord(permission, school.program_id)) return false;
  }
  return true;
}

// Synchronous helper to get program context from a permission object
export function getProgramContextSync(
  permission: UserPermission | null
): ProgramPermissionContext {
  if (!permission) {
    return {
      hasAccess: false,
      programIds: [],
      isNVSOnly: false,
      hasCoEOrNodal: false,
    };
  }

  // Admins always have full access regardless of program_ids
  if (permission.role === "admin") {
    return {
      hasAccess: true,
      programIds: permission.program_ids || [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL, PROGRAM_IDS.NVS],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    };
  }

  // Effective programs = explicit program_ids ∪ seat-derived programs. Each
  // centre seat implies exactly one program, so this mirrors resolveScope's
  // additive school union: a seated user reaches the program their seat implies
  // even when program_ids is empty. scope.programs is populated only via
  // getResolvedPermission; a bare getUserPermission falls back to explicit ids.
  const seatPrograms = permission.scope?.programs;
  if (seatPrograms === "all") {
    return {
      hasAccess: true,
      programIds: permission.program_ids?.length
        ? permission.program_ids
        : [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL, PROGRAM_IDS.NVS],
      isNVSOnly: false,
      hasCoEOrNodal: true,
    };
  }
  const programIds = Array.from(
    new Set<number>([
      ...(permission.program_ids ?? []),
      ...(seatPrograms ?? []),
    ])
  );

  // For non-admins, require at least one program (explicit or seat-derived)
  if (programIds.length === 0) {
    return {
      hasAccess: false,
      programIds: [],
      isNVSOnly: false,
      hasCoEOrNodal: false,
    };
  }

  const hasNVS = programIds.includes(PROGRAM_IDS.NVS);
  // The full LMS feature set (curriculum, quiz sessions, visits, PM dashboard,
  // summary stats) is granted by ANY non-NVS program — JNV CoE/Nodal plus every
  // physical-centre program (Punjab CoE/Nodal, EMRS CoE, Uttarakhand CoE, …).
  // Only NVS-only users are gated out. A Punjab/EMRS/RGNV teacher must not be
  // treated as NVS-only.
  const hasCoEOrNodal = programIds.some((id) =>
    PHYSICAL_CENTRE_PROGRAM_IDS.includes(id)
  );
  const isNVSOnly = hasNVS && !hasCoEOrNodal;

  return {
    hasAccess: true,
    programIds,
    isNVSOnly,
    hasCoEOrNodal,
  };
}

// Async version that fetches permission first
export async function getProgramContext(
  email: string
): Promise<ProgramPermissionContext> {
  const permission = await getUserPermission(email);
  return getProgramContextSync(permission);
}
