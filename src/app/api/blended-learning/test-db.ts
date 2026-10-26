import { vi } from "vitest";
import { getServerSession } from "next-auth";

import { getBlendedLearningAccess, type BlendedLearningAccess } from "@/lib/blended-learning-access";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { query, withTransaction } from "@/lib/db";

// Shared scaffolding for the Blended Learning write-route tests. Each test
// file mocks next-auth, @/lib/auth, @/lib/db and getBlendedLearningAccess
// (vi.mock is hoisted per file); mockBlendedDb() wires those mocks. Queries
// are scripted in call order with mockResolvedValueOnce: `query` outside a
// transaction, `clientQuery` inside withTransaction. No SQL is interpreted:
// the real-DB e2e specs cover what the database does with it.

export const MENTOR: BlendedLearningAccess = {
  kind: "mentor",
  role: "blended_mentor",
  readOnly: false,
  actorEmail: "mentor@test.local",
  mentorUserId: 9001,
};

export const READ_ONLY_ADMIN: BlendedLearningAccess = {
  kind: "admin",
  role: "blended_admin",
  readOnly: true,
  actorEmail: "viewer@test.local",
};

// Student 501's active Mapping, to the Mentor above.
export const MAPPING = { mentor_user_id: 9001, program_id: 80, academic_year: CURRENT_ACADEMIC_YEAR };

// A pg QueryResult for `clientQuery`.
export function rows(...result: Record<string, unknown>[]) {
  return { rows: result, rowCount: result.length };
}

// A Postgres error with its SQLSTATE.
export function pgError(code: string) {
  return Object.assign(new Error(`pg ${code}`), { code });
}

// null: signed out. "no access": signed in without Blended Learning access.
export function signedInAs(who: BlendedLearningAccess | "no access" | null): void {
  const email = who === "no access" ? "teacher@test.local" : who?.actorEmail;
  vi.mocked(getServerSession).mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
  vi.mocked(getBlendedLearningAccess).mockResolvedValue(who === "no access" ? null : who);
}

export function mockBlendedDb() {
  const dbQuery = vi.mocked(query);
  dbQuery.mockReset();
  dbQuery.mockResolvedValue([]);
  const clientQuery = vi.fn().mockResolvedValue(rows());
  vi.mocked(withTransaction).mockReset();
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn({ query: clientQuery } as never));
  return { query: dbQuery, clientQuery };
}
