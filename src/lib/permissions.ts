// Permission levels
export type AccessLevel = 1 | 2 | 3;
// 1 = Single school access
// 2 = Region access (all schools in a region)
// 3 = All schools access

export interface UserPermission {
  email: string;
  level: AccessLevel;
  schoolCodes?: string[];  // For level 1
  regions?: string[];       // For level 2
}

export interface SchoolPasscode {
  schoolCode: string;
  passcode: string;  // 8 digits
}

// Hardcoded permissions - move to DB later
const USER_PERMISSIONS: UserPermission[] = [
  // Level 3: All schools access
  { email: "pritam@avantifellows.org", level: 3 },
  { email: "aman.bahuguna@avantifellows.org", level: 3 },
  { email: "dhyaneshwaran@avantifellows.org", level: 3 },

  // Level 1: Single school access
  { email: "pritamps@gmail.com", level: 1, schoolCodes: ["14042"] },
];

// School passcodes - 8 digit codes for schools without Google
// Format: schoolCode -> passcode
const SCHOOL_PASSCODES: SchoolPasscode[] = [
  { schoolCode: "70705", passcode: "70705123" },  // JNV Bhavnagar
  { schoolCode: "14042", passcode: "14042456" },
  // Add more schools as needed
];

export function getUserPermission(email: string): UserPermission | null {
  return USER_PERMISSIONS.find(p => p.email.toLowerCase() === email.toLowerCase()) || null;
}

export function getSchoolByPasscode(passcode: string): string | null {
  const entry = SCHOOL_PASSCODES.find(s => s.passcode === passcode);
  return entry?.schoolCode || null;
}

export function canAccessSchool(
  email: string | null,
  schoolCode: string,
  schoolRegion?: string
): boolean {
  if (!email) return false;

  const permission = getUserPermission(email);
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
      return permission.schoolCodes?.includes(schoolCode) || false;
    default:
      return false;
  }
}

export function getAccessibleSchoolCodes(email: string): string[] | "all" {
  const permission = getUserPermission(email);
  if (!permission) return [];

  if (permission.level === 3) return "all";
  if (permission.level === 1) return permission.schoolCodes || [];

  // For level 2, would need to query DB for schools in region
  // For now, return empty
  return [];
}
