import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, READ_ONLY_ADMIN, mockBlendedDb, rows, signedInAs } from "../../../test-db";
import { POST } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const move = (body: string, id = "2") =>
  POST(new Request(`http://localhost/api/blended-learning/resources/${id}/move`, { method: "POST", body }), params(id));

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("POST /api/blended-learning/resources/[id]/move", () => {
  it("moves a Resource up a place", async () => {
    signedInAs(ADMIN);
    db.clientQuery.mockResolvedValueOnce(rows({ id: 1 }, { id: 2 }));

    const res = await move(JSON.stringify({ direction: "up" }));

    expect(res.status).toBe(200);
    expect(db.clientQuery.mock.calls[1][1]).toEqual([[2, 1], ADMIN.actorEmail]);
  });

  it("is a 422 without a direction or JSON, and a 403 for a read-only admin", async () => {
    signedInAs(ADMIN);
    expect((await move(JSON.stringify({ direction: "sideways" }))).status).toBe(422);
    expect((await move("nope")).status).toBe(422);
    signedInAs(READ_ONLY_ADMIN);
    expect((await move(JSON.stringify({ direction: "up" }))).status).toBe(403);
    expect(db.clientQuery).not.toHaveBeenCalled();
  });
});
