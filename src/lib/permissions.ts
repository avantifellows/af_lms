import { query } from "./db";

// Permission levels (school scope only)
export type AccessLevel = 1 | 2 | 3;
// 1 = Single school access
// 2 = Region access (all schools in a region)
// 3 = All schools access

// User roles
export type UserRole = "teacher" | "program_manager" | "program_admin" | "admin";

// Program IDs
export const PROGRAM_IDS = {
  COE: 1,
  NODAL: 2,
  NVS: 64,
} as const;

// Feature types for permission checking
export type Feature = "students" | "visits" | "curriculum" | "mentorship" | "performance" | "summary_stats" | "pm_dashboard";

// Feature access levels
export type FeatureAccess = "none" | "view" | "edit";

// Feature permission matrix: feature → role → access level
const FEATURE_PERMISSIONS: Record<Feature, Record<UserRole, FeatureAccess>> = {
  students:      { teacher: "edit",  program_manager: "edit",  program_admin: "edit",  admin: "edit" },
  visits:        { teacher: "none",  program_manager: "edit",  program_admin: "view",  admin: "edit" },
  curriculum:    { teacher: "edit",  program_manager: "view",  program_admin: "edit",  admin: "edit" },
  mentorship:    { teacher: "edit",  program_manager: "view",  program_admin: "edit",  admin: "edit" },
  performance:   { teacher: "view",  program_manager: "view",  program_admin: "view",  admin: "view" },
  summary_stats: { teacher: "none",  program_manager: "view",  program_admin: "view",  admin: "view" },
  pm_dashboard:  { teacher: "none",  program_manager: "view",  program_admin: "view",  admin: "view" },
};

// Features gated to CoE/Nodal programs only (NVS-only users get "none")
const NVS_GATED_FEATURES: Set<Feature> = new Set([
  "visits", "curriculum", "mentorship", "pm_dashboard", "summary_stats",
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
}

// Program permission context
export interface ProgramPermissionContext {
  hasAccess: boolean;
  programIds: number[];
  isNVSOnly: boolean;
  hasCoEOrNodal: boolean;
}

export interface SchoolPasscode {
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
  const results = await query<{
    email: string;
    level: number;
    role: string;
    school_codes: string[] | null;
    regions: string[] | null;
    program_ids: number[] | null;
    read_only: boolean;
  }>(
    `SELECT email, level, role, school_codes, regions, program_ids, read_only
     FROM user_permission
     WHERE LOWER(email) = LOWER($1)`,
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
  };
}

export function getSchoolByPasscode(passcode: string): string | null {
  const entry = SCHOOL_PASSCODES.find((s) => s.passcode === passcode);
  return entry?.schoolCode || null;
}

export async function canAccessSchool(
  email: string | null,
  schoolCode: string,
  schoolRegion?: string
): Promise<boolean> {
  if (!email) return false;

  const permission = await getUserPermission(email);
  if (!permission) return false;

  switch (permission.level) {
    case 3:
      // All schools access
      return true;
    case 2:
      // Region access
      return permission.regions?.includes(schoolRegion || "") || false;
    case 1:
      // Single school access
      return permission.school_codes?.includes(schoolCode) || false;
    default:
      return false;
  }
}

export async function getAccessibleSchoolCodes(
  email: string,
  existingPermission?: UserPermission | null
): Promise<string[] | "all"> {
  const permission = existingPermission !== undefined ? existingPermission : await getUserPermission(email);
  if (!permission) return [];

  if (permission.level === 3) return "all";
  if (permission.level === 1) return permission.school_codes || [];

  // Level 2: fetch all school codes in the user's assigned regions
  if (permission.level === 2 && permission.regions && permission.regions.length > 0) {
    const schools = await query<{ code: string }>(
      `SELECT code FROM school
       WHERE af_school_category = 'JNV'
         AND region = ANY($1)`,
      [permission.regions]
    );
    return schools.map((s) => s.code);
  }

  return [];
}

export async function isAdmin(email: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  return permission?.role === "admin";
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

  // For non-admins, require program_ids
  if (!permission.program_ids || permission.program_ids.length === 0) {
    return {
      hasAccess: false,
      programIds: [],
      isNVSOnly: false,
      hasCoEOrNodal: false,
    };
  }

  const programIds = permission.program_ids;
  const hasNVS = programIds.includes(PROGRAM_IDS.NVS);
  const hasCoE = programIds.includes(PROGRAM_IDS.COE);
  const hasNodal = programIds.includes(PROGRAM_IDS.NODAL);
  const hasCoEOrNodal = hasCoE || hasNodal;
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

