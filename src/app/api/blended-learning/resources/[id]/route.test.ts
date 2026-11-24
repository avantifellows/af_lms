import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, mockBlendedDb, signedInAs } from "../../test-db";
import { DELETE, PATCH } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const url = "http://localhost/api/blended-learning/resources/3";

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("PATCH /api/blended-learning/resources/[id]", () => {
  it("edits the title and link", async () => {
    signedInAs(ADMIN);
    db.query.mockResolvedValue([{ id: 3, title: "New", url: "https://example.org/new" }]);

    const res = await PATCH(
      new Request(url, { method: "PATCH", body: JSON.stringify({ title: "New", url: "https://example.org/new" }) }),
      params("3")
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 3, title: "New", url: "https://example.org/new" });
  });

  it("is a 404 for an unknown or malformed id, a 422 for a bad body and a 403 for a Mentor", async () => {
    signedInAs(ADMIN);
    const body = JSON.stringify({ title: "New", url: "https://example.org/new" });
    expect((await PATCH(new Request(url, { method: "PATCH", body }), params("3"))).status).toBe(404);
    expect((await PATCH(new Request(url, { method: "PATCH", body }), params("abc"))).status).toBe(404);
    expect((await PATCH(new Request(url, { method: "PATCH", body: "{" }), params("3"))).status).toBe(422);
    signedInAs(MENTOR);
    expect((await PATCH(new Request(url, { method: "PATCH", body }), params("3"))).status).toBe(403);
  });
});

describe("DELETE /api/blended-learning/resources/[id]", () => {
  it("removes it (204), or is a 404, and refuses a Mentor", async () => {
    signedInAs(ADMIN);
    db.query.mockResolvedValueOnce([{ id: 3 }]).mockResolvedValueOnce([]);
    expect((await DELETE(new Request(url, { method: "DELETE" }), params("3"))).status).toBe(204);
    expect((await DELETE(new Request(url, { method: "DELETE" }), params("3"))).status).toBe(404);

    signedInAs(MENTOR);
    expect((await DELETE(new Request(url, { method: "DELETE" }), params("3"))).status).toBe(403);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
