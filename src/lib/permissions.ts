import { query } from "./db";

// Permission levels
export type AccessLevel = 1 | 2 | 3 | 4;
// 1 = Single school access
// 2 = Region access (all schools in a region)
// 3 = All schools access
// 4 = Admin (all schools + user management)

// User roles
export type UserRole = "teacher" | "program_manager" | "admin";

export interface UserPermission {
  email: string;
  level: AccessLevel;
  role: UserRole;
  school_codes?: string[] | null;
  regions?: string[] | null;
  read_only?: boolean;
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
    read_only: boolean;
  }>(
    `SELECT email, level, role, school_codes, regions, read_only
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
  email: string
): Promise<string[] | "all"> {
  const permission = await getUserPermission(email);
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
  return permission.role === "program_manager" || permission.role === "admin";
}

// Check if user can edit curriculum (teachers and admins can, PMs cannot)
export async function canEditCurriculum(email: string): Promise<boolean> {
  const permission = await getUserPermission(email);
  if (!permission) return false;
  // Admins can always edit
  if (permission.role === "admin") return true;
  // Teachers can edit (not read_only)
  if (permission.role === "teacher" && !permission.read_only) return true;
  // PMs are view-only for curriculum
  return false;
}
