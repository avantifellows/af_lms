import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, mockBlendedDb, signedInAs } from "../../test-db";
import { GET } from "./route";

const preview = (query: string) =>
  GET(new Request(`http://localhost/api/blended-learning/common-action-items/preview?${query}`));

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("GET /api/blended-learning/common-action-items/preview", () => {
  it("counts the Students a target reaches", async () => {
    signedInAs(ADMIN);
    db.query.mockResolvedValue([{ count: "12" }]);

    const res = await preview("kind=mentor&mentorUserId=77");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 12 });
    expect(db.query.mock.calls[0][1]).toEqual(["mentor", null, 77, "2026-2027"]);
  });

  it("is a 422 for an incomplete target and a 403 for a Mentor", async () => {
    signedInAs(ADMIN);
    expect((await preview("kind=grade&grade=11")).status).toBe(422);
    expect((await preview("")).status).toBe(422);
    signedInAs(MENTOR);
    expect((await preview("kind=all")).status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});
