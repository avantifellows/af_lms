import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, mockBlendedDb, rows, signedInAs } from "../../../test-db";
import { POST } from "./route";

const push = (id = "8") =>
  POST(new Request(`http://localhost/api/blended-learning/common-action-items/${id}/push`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("POST /api/blended-learning/common-action-items/[id]/push", () => {
  it("adds it to targeted Students who don't have it yet", async () => {
    signedInAs(ADMIN);
    db.clientQuery.mockResolvedValueOnce(rows({ id: 8 })).mockResolvedValueOnce(rows({ id: 40 }));

    const res = await push();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1 });
  });

  it("is a 404 once removed, and a 403 for a Mentor", async () => {
    signedInAs(ADMIN);
    expect((await push()).status).toBe(404);
    signedInAs(MENTOR);
    expect((await push()).status).toBe(403);
  });
});
