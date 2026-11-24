import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, READ_ONLY_ADMIN, mockBlendedDb, rows, signedInAs } from "../test-db";
import { POST } from "./route";

const BODY = { text: "Fill in the scholarship form", owner: "student", target: { kind: "grade", grade: 12 } };

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/blended-learning/common-action-items", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("POST /api/blended-learning/common-action-items", () => {
  it("saves and pushes it, answering 201 with how many Students got it", async () => {
    signedInAs(ADMIN);
    db.clientQuery.mockResolvedValueOnce(rows({ id: 8 })).mockResolvedValueOnce(rows({ id: 1 }, { id: 2 }, { id: 3 }));

    const res = await post(BODY);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 8, added: 3 });
  });

  it.each([
    ["signed out", null, 401],
    ["a Mentor", MENTOR, 403],
    ["a read-only admin", READ_ONLY_ADMIN, 403],
  ])("refuses %s", async (_who, who, status) => {
    signedInAs(who);
    expect((await post(BODY)).status).toBe(status);
    expect(db.clientQuery).not.toHaveBeenCalled();
  });

  it("is a 422 for a bad body, or a target with no Students", async () => {
    signedInAs(ADMIN);
    expect((await post({ ...BODY, owner: "sibling" })).status).toBe(422);
    expect((await post("{")).status).toBe(422);
    db.clientQuery.mockResolvedValueOnce(rows({ id: 8 })).mockResolvedValueOnce(rows());
    const res = await post(BODY);
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors).toEqual({ target: "No students match this target. Choose another." });
  });
});
