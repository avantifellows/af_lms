import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, mockBlendedDb, rows, signedInAs } from "../../test-db";
import { DELETE, PATCH } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const url = "http://localhost/api/blended-learning/common-action-items/8";
const patch = (body: string, id = "8") => PATCH(new Request(url, { method: "PATCH", body }), params(id));
const remove = (id = "8") => DELETE(new Request(url, { method: "DELETE" }), params(id));

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("PATCH /api/blended-learning/common-action-items/[id]", () => {
  it("updates it and answers how many open Action Items changed", async () => {
    signedInAs(ADMIN);
    db.clientQuery
      .mockResolvedValueOnce(rows({ id: 8 }))
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce({ rows: [], rowCount: 5 });

    const res = await patch(JSON.stringify({ text: "New text", owner: "mentor" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updatedOpen: 5 });
  });

  it("is a 404 when removed, a 422 for a bad body and a 403 for a Mentor", async () => {
    signedInAs(ADMIN);
    expect((await patch(JSON.stringify({ text: "New text", owner: "mentor" }))).status).toBe(404);
    expect((await patch(JSON.stringify({ text: "", owner: "mentor" }))).status).toBe(422);
    expect((await patch("x")).status).toBe(422);
    signedInAs(MENTOR);
    expect((await patch(JSON.stringify({ text: "New text", owner: "mentor" }))).status).toBe(403);
  });
});

describe("DELETE /api/blended-learning/common-action-items/[id]", () => {
  it("removes it and answers how many open Action Items were deleted", async () => {
    signedInAs(ADMIN);
    db.clientQuery
      .mockResolvedValueOnce(rows({ id: 8 }))
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce({ rows: [], rowCount: 2 });

    const res = await remove();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedOpen: 2 });
  });

  it("is a 404 once removed or for a malformed id, and a 403 for a Mentor", async () => {
    signedInAs(ADMIN);
    expect((await remove()).status).toBe(404);
    expect((await remove("x")).status).toBe(404);
    signedInAs(MENTOR);
    expect((await remove()).status).toBe(403);
  });
});
