import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, READ_ONLY_ADMIN, SUPERVISOR, mockBlendedDb, rows, signedInAs } from "../../../test-db";
import { POST } from "./route";

const end = (id: string) =>
  POST(new Request(`http://localhost/api/blended-learning/team-leads/${id}/end`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("POST /api/blended-learning/team-leads/[id]/end", () => {
  it("ends the running Supervision, recorded as from the Manage page by the admin", async () => {
    signedInAs(ADMIN);
    db.query.mockResolvedValueOnce([{ supervisor_user_id: "9003", mentor_user_id: "9001" }]);
    db.clientQuery.mockResolvedValueOnce(rows({ id: 7 }));

    const res = await end("7");

    expect(res.status).toBe(204);
    expect(db.query.mock.calls[0][1]).toEqual([7, "2026-2027"]);
    expect(db.query.mock.calls[0][0]).toContain("supervision.ended_at IS NULL");
    const [update, params] = db.clientQuery.mock.calls[0];
    expect(update).toContain("SET ended_at = GREATEST(started_at,");
    expect(params).toEqual([9003, 9001, "2026-2027", "admin@test.local", "af_lms_manage_ui", "supervision_ended", null]);
  });

  it("is a 404 for a Supervision that isn't running, or ended meanwhile", async () => {
    signedInAs(ADMIN);
    expect((await end("7")).status).toBe(404);
    expect(db.clientQuery).not.toHaveBeenCalled();

    db.query.mockResolvedValueOnce([{ supervisor_user_id: 9003, mentor_user_id: 9001 }]);
    db.clientQuery.mockResolvedValueOnce(rows());
    expect((await end("7")).status).toBe(404);
  });

  it("is a 404 for a malformed id, without reading", async () => {
    signedInAs(ADMIN);
    expect((await end("abc")).status).toBe(404);
    expect((await end("0")).status).toBe(404);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out", null, 401],
    ["a Mentor", MENTOR, 403],
    ["a team lead", SUPERVISOR, 403],
    ["a read-only admin", READ_ONLY_ADMIN, 403],
  ])("refuses %s", async (_who, who, status) => {
    signedInAs(who);
    expect((await end("7")).status).toBe(status);
    expect(db.query).not.toHaveBeenCalled();
  });
});
