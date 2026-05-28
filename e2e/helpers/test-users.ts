import { Pool } from "pg";

export interface TestUser {
  email: string;
  level: number;
  role: string;
  program_ids: number[] | null;
  school_codes: string[] | null;
  regions: string[] | null;
  read_only: boolean;
  full_name?: string | null;
}

export const TEST_USERS = {
  admin: {
    email: "e2e-admin@test.local",
    level: 3,
    role: "admin",
    program_ids: [1, 2, 64],
    school_codes: null,
    regions: null,
    read_only: false,
  },
  pm: {
    email: "e2e-pm@test.local",
    level: 2,
    role: "program_manager",
    program_ids: [1, 2],
    school_codes: null,
    regions: ["AHMEDABAD"], // Must match a region in your dump
    read_only: false,
  },
  programAdmin: {
    email: "e2e-program-admin@test.local",
    level: 2,
    role: "program_admin",
    program_ids: [1, 2],
    school_codes: null,
    regions: ["AHMEDABAD"],
    read_only: false,
  },
  readOnlyProgramAdmin: {
    email: "e2e-ro-program-admin@test.local",
    level: 2,
    role: "program_admin",
    program_ids: [1, 2],
    school_codes: null,
    regions: ["AHMEDABAD"],
    read_only: true,
  },
  teacher: {
    email: "e2e-teacher@test.local",
    level: 1,
    role: "teacher",
    program_ids: [64],
    school_codes: ["70705", "14042"], // Must match school codes in your dump
    regions: null,
    read_only: false,
  },
  mentorshipTeacher: {
    email: "e2e-mentorship-teacher@test.local",
    level: 1,
    role: "teacher",
    program_ids: [1],
    school_codes: ["70705"],
    regions: null,
    read_only: false,
    full_name: "E2E Mentorship Teacher",
  },
} as const satisfies Record<string, TestUser>;

export type TestUserRole = keyof typeof TEST_USERS;

/**
 * Insert deterministic test users into user_permission table.
 * Uses upsert so it's safe to call multiple times.
 */
export async function insertTestUsers(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    for (const user of Object.values(TEST_USERS)) {
      await client.query(
        `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only, full_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (email) DO UPDATE SET
           level = EXCLUDED.level,
           role = EXCLUDED.role,
           program_ids = EXCLUDED.program_ids,
           school_codes = EXCLUDED.school_codes,
           regions = EXCLUDED.regions,
           read_only = EXCLUDED.read_only,
           full_name = EXCLUDED.full_name`,
        [
          user.email,
          user.level,
          user.role,
          user.program_ids,
          user.school_codes,
          user.regions,
          user.read_only,
          "full_name" in user ? user.full_name : null,
        ]
      );
    }
  } finally {
    client.release();
  }
}
