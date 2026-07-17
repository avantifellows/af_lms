import { Pool } from "pg";

export interface TestUser {
  email: string;
  level: number;
  role: string;
  program_ids: number[] | null;
  school_codes: string[] | null;
  regions: string[] | null;
  read_only: boolean;
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
  teacher: {
    email: "e2e-teacher@test.local",
    level: 1,
    role: "teacher",
    program_ids: [64],
    school_codes: ["70705", "14042"], // Must match school codes in your dump
    regions: null,
    read_only: false,
  },
  holisticAdmin: {
    email: "e2e-holistic-admin@test.local",
    level: 3,
    role: "holistic_mentorship_admin",
    program_ids: [1],
    school_codes: null,
    regions: null,
    read_only: false,
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
      const userResult = await client.query<{ id: number }>(
        `WITH existing AS (
           SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) LIMIT 1
         ),
         inserted AS (
           INSERT INTO "user" (email, role, inserted_at, updated_at)
           SELECT $1, $2, (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC')
           WHERE NOT EXISTS (SELECT 1 FROM existing)
           RETURNING id
         )
         SELECT id FROM inserted
         UNION ALL
         SELECT id FROM existing
         LIMIT 1`,
        [user.email, user.role]
      );
      const userId = userResult.rows[0].id;

      await client.query(
        `INSERT INTO user_permission (email, level, role, program_ids, school_codes, regions, read_only, user_id, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
         ON CONFLICT (email) DO UPDATE SET
           level = EXCLUDED.level,
           role = EXCLUDED.role,
           program_ids = EXCLUDED.program_ids,
           school_codes = EXCLUDED.school_codes,
           regions = EXCLUDED.regions,
           read_only = EXCLUDED.read_only,
           user_id = EXCLUDED.user_id,
           revoked_at = NULL`,
        [
          user.email,
          user.level,
          user.role,
          user.program_ids,
          user.school_codes,
          user.regions,
          user.read_only,
          userId,
        ]
      );
    }
  } finally {
    client.release();
  }
}
