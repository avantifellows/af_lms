import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, READ_ONLY_ADMIN, mockBlendedDb, signedInAs } from "../test-db";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/blended-learning/resources", {
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

describe("POST /api/blended-learning/resources", () => {
  it("adds a Resource for an admin who may manage", async () => {
    signedInAs(ADMIN);
    db.query.mockResolvedValue([{ id: 5, title: "Guide", url: "https://example.org/guide" }]);

    const res = await post({ title: "Guide", url: "https://example.org/guide" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 5, title: "Guide", url: "https://example.org/guide" });
  });

  it.each([
    ["signed out", null, 401],
    ["without Blended Learning", "no access" as const, 403],
    ["a Mentor", MENTOR, 403],
    ["a read-only admin", READ_ONLY_ADMIN, 403],
  ])("refuses %s", async (_who, who, status) => {
    signedInAs(who);
    expect((await post({ title: "Guide", url: "https://example.org" })).status).toBe(status);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is a 422 with field errors for a bad body", async () => {
    signedInAs(ADMIN);
    const res = await post({ title: "", url: "http://example.org" });
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors).toEqual({
      title: "Enter a title.",
      url: "Enter a full link starting with https://",
    });
    expect((await post("not json")).status).toBe(422);
  });
});
