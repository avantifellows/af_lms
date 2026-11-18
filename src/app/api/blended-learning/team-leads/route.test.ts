import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, READ_ONLY_ADMIN, SUPERVISOR, mockBlendedDb, rows, signedInAs } from "../test-db";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/blended-learning/team-leads", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

let db: ReturnType<typeof mockBlendedDb>;

// Both ids are Blended Learning Mentors (the lookup returns them).
function givenMentors(...ids: number[]) {
  db.query.mockResolvedValueOnce(ids.map((id) => ({ id: String(id), name: `Mentor ${id}` })));
}

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("POST /api/blended-learning/team-leads", () => {
  it("starts the Supervision, recorded as from the Manage page by the admin", async () => {
    signedInAs(ADMIN);
    givenMentors(9003, 9001);
    db.clientQuery.mockResolvedValueOnce(rows({ id: 7 }));

    const res = await post({ supervisorUserId: 9003, mentorUserId: "9001" });

    expect(res.status).toBe(201);
    // Both checked as Blended Learning Mentors: Mappings or a live blended_mentor permission.
    const [lookup, lookupParams] = db.query.mock.calls[0];
    expect(lookup).toContain("blended_learning_mentor_mentee_mappings");
    expect(lookup).toContain("permission.role = $2 AND permission.revoked_at IS NULL");
    expect(lookupParams).toEqual(["2026-2027", "blended_mentor", [9003, 9001]]);
    const [insert, insertParams] = db.clientQuery.mock.calls[0];
    expect(insert).toContain("ON CONFLICT (supervisor_user_id, mentor_user_id, academic_year) WHERE ended_at IS NULL DO NOTHING");
    expect(insertParams).toEqual([9003, 9001, "2026-2027", "admin@test.local", "af_lms_manage_ui", null]);
  });

  it("is a 409 when the pair already runs a Supervision", async () => {
    signedInAs(ADMIN);
    givenMentors(9003, 9001);
    db.clientQuery.mockResolvedValueOnce(rows());

    const res = await post({ supervisorUserId: 9003, mentorUserId: 9001 });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This team lead already leads this mentor.");
  });

  it("is a 422 when either one isn't a Blended Learning Mentor", async () => {
    signedInAs(ADMIN);
    givenMentors(9003);

    const res = await post({ supervisorUserId: 9003, mentorUserId: 4242 });

    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors).toEqual({ mentorUserId: "Choose a Blended Learning mentor." });
    expect(db.clientQuery).not.toHaveBeenCalled();
  });

  it.each([
    [{}, { supervisorUserId: "Choose a team lead.", mentorUserId: "Choose the mentor they lead." }],
    [{ supervisorUserId: 9003, mentorUserId: 9003 }, { mentorUserId: "Choose someone other than the team lead." }],
    [{ supervisorUserId: -1, mentorUserId: "9x" }, { supervisorUserId: "Choose a team lead.", mentorUserId: "Choose the mentor they lead." }],
  ])("is a 422 without reading for %j", async (body, fieldErrors) => {
    signedInAs(ADMIN);

    const res = await post(body);

    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors).toEqual(fieldErrors);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is a 422 for a body that isn't JSON", async () => {
    signedInAs(ADMIN);
    expect((await post("not json")).status).toBe(422);
  });

  it.each([
    ["signed out", null, 401],
    ["without Blended Learning", "no access" as const, 403],
    ["a Mentor", MENTOR, 403],
    ["a team lead", SUPERVISOR, 403],
    ["a read-only admin", READ_ONLY_ADMIN, 403],
  ])("refuses %s", async (_who, who, status) => {
    signedInAs(who);
    expect((await post({ supervisorUserId: 9003, mentorUserId: 9001 })).status).toBe(status);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.clientQuery).not.toHaveBeenCalled();
  });
});
