import { query } from "./db";

// Permission levels
export type AccessLevel = 1 | 2 | 3 | 4;
// 1 = Single school access
// 2 = Region access (all schools in a region)
// 3 = All schools access
// 4 = Admin (all schools + user management)

// User roles
export type UserRole = "teacher" | "program_manager" | "admin";

// Program IDs
export const PROGRAM_IDS = {
  COE: 1,
  NODAL: 2,
  NVS: 64,
} as const;

// Feature types for permission checking
export type Feature = "students" | "visits" | "curriculum" | "mentorship" | "analytics";

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
    case 4:
    case 3:
      // Admin and All schools access
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

  if (permission.level === 4 || permission.level === 3) return "all";
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
  return permission?.level === 4;
}

export async function canEditStudents(email: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  return permission !== null && !permission.read_only;
}

export async function isProgramManager(email: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  return permission?.role === "program_manager" || permission?.role === "admin";
}

export async function getUserRole(email: string): Promise<UserRole | null> {
  const permission = await getUserPermission(email);
  return permission?.role || null;
}

export async function canAccessPMFeatures(email: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  if (!permission) return false;

  // Must have PM or Admin role
  const hasRole = permission.role === "program_manager" || permission.role === "admin";
  if (!hasRole) return false;

  // Must have CoE or Nodal program (NVS-only PMs don't get visit features)
  const context = getProgramContextSync(permission);
  return context.hasCoEOrNodal;
}

// Check if user can edit curriculum (teachers and admins can, PMs cannot)
// Also requires CoE/Nodal program access
export async function canEditCurriculum(email: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  if (!permission) return false;

  // Must have CoE/Nodal program access
  const context = getProgramContextSync(permission);
  if (!context.hasCoEOrNodal) return false;

  // Admins can always edit
  if (permission.role === "admin") return true;
  // Teachers can edit (not read_only)
  if (permission.role === "teacher" && !permission.read_only) return true;
  // PMs are view-only for curriculum
  return false;
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

// Check if user can access a specific feature based on their programs
export async function canAccessFeature(
  email: string,
  feature: Feature
): Promise<boolean> {
  const permission = await getUserPermission(email);
  if (!permission) return false;

  // Admins can access everything
  if (permission.role === "admin") {
    return true;
  }

  const context = getProgramContextSync(permission);
  if (!context.hasAccess) return false;

  // Feature-specific checks
  switch (feature) {
    case "students":
    case "analytics":
      // All programs can access students and analytics
      return true;

    case "visits":
    case "curriculum":
    case "mentorship":
      // NVS-only users cannot access these features
      return context.hasCoEOrNodal;

    default:
      return false;
  }
}

// Get program filter for students
// Returns null if user can see all students, or array of program IDs to filter by
export async function getStudentProgramFilter(
  email: string
): Promise<number[] | null> {
  const permission = await getUserPermission(email);
  if (!permission) return []; // No access - empty array means no students

  // Admins see all students
  if (permission.role === "admin") {
    return null; // null = no filter (see all)
  }

  const context = getProgramContextSync(permission);
  if (!context.hasAccess) return [];

  // CoE/Nodal users see all students for context
  if (context.hasCoEOrNodal) {
    return null; // null = no filter (see all)
  }

  // NVS-only users see only NVS students
  return context.programIds;
}
