import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);

const MENTOR_A = "faizan@avantifellows.org";
const ADMIN = "juned@avantifellows.org";
const ADMIN_READ_ONLY = "shalinijha@avantifellows.org";
const LMS_ADMIN = "admin@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [ADMIN]: { role: "blended_admin", read_only: false, user_id: 11 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [LMS_ADMIN]: { role: "admin", read_only: false, user_id: 1 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};

type FlagView = { viewer_email: string; viewer_user_id: number | null; last_seen_at: string };
// The flag views table with its unique index on lower(viewer_email): an
// insert whose ON CONFLICT does not target that index violates it, as in
// Postgres. Every write stamps last_seen_at with NOW.
let views: FlagView[];
const NOW = "2026-10-22 06:00:00";

beforeEach(() => {
  vi.clearAllMocks();
  views = [{ viewer_email: "ShaliniJha@avantifellows.org", viewer_user_id: 12, last_seen_at: "2026-10-19 09:30:00" }];
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_permission")) {
      const email = String(params?.[0]).toLowerCase();
      const row = PERMISSIONS[email];
      return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
    }
    if (sql.includes("INSERT INTO blended_learning_flag_views")) {
      const [email, userId] = params ?? [];
      const existing = views.find((row) => row.viewer_email.toLowerCase() === String(email).toLowerCase());
      if (existing && !/ON CONFLICT \(\(lower\(viewer_email\)\)\) DO UPDATE/i.test(sql)) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      }
      if (existing) {
        existing.last_seen_at = NOW;
        return [{ last_seen_at: NOW }];
      }
      views.push({ viewer_email: String(email), viewer_user_id: userId == null ? null : Number(userId), last_seen_at: NOW });
      return [{ last_seen_at: NOW }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function markSeen() {
  const res = await POST();
  return { status: res.status, body: await res.json() };
}

describe("POST /api/blended-learning/flags/seen", () => {
  it("returns 401 when signed out and records nothing", async () => {
    signedInAs(null);
    const before = structuredClone(views);

    expect(await markSeen()).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(views).toEqual(before);
  });

  it.each([
    ["a Blended Learning Mentor", MENTOR_A],
    ["a role without Blended Learning access", TEACHER],
  ])("returns 403 for %s and records nothing", async (_case, email) => {
    signedInAs(email);
    const before = structuredClone(views);

    expect(await markSeen()).toEqual({ status: 403, body: { error: "Forbidden" } });
    expect(views).toEqual(before);
  });

  it("lets a read-only Blended Learning Admin record a visit, updating their row whatever its email case", async () => {
    signedInAs(ADMIN_READ_ONLY);

    expect(await markSeen()).toEqual({ status: 200, body: { lastSeenAt: NOW } });
    expect(views).toEqual([
      { viewer_email: "ShaliniJha@avantifellows.org", viewer_user_id: 12, last_seen_at: NOW },
    ]);
  });

  it.each([
    ["a Blended Learning Admin", ADMIN, 11],
    ["an LMS admin", LMS_ADMIN, 1],
  ])("records a first visit for %s", async (_case, email, userId) => {
    signedInAs(email);

    expect(await markSeen()).toEqual({ status: 200, body: { lastSeenAt: NOW } });
    expect(views).toContainEqual({ viewer_email: email, viewer_user_id: userId, last_seen_at: NOW });
    expect(views).toHaveLength(2);
  });

  it("keeps one row per viewer across visits", async () => {
    signedInAs(ADMIN);

    await markSeen();
    await markSeen();

    expect(views.filter((row) => row.viewer_email.toLowerCase() === ADMIN)).toHaveLength(1);
  });
});
