import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { ADMIN, MENTOR, mockBlendedDb, signedInAs } from "../../test-db";
import { POST } from "./route";

const preview = (body: unknown) =>
  POST(
    new Request("http://localhost/api/blended-learning/common-action-items/preview", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

let db: ReturnType<typeof mockBlendedDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
});

describe("POST /api/blended-learning/common-action-items/preview", () => {
  it("counts the Students a Mentor target reaches", async () => {
    signedInAs(ADMIN);
    db.query.mockResolvedValue([{ count: "12" }]);

    const res = await preview({ kind: "mentor", mentorUserId: "77" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 12, notFound: [], noMentor: [] });
    expect(db.query.mock.calls[0][1]).toEqual(["mentor", null, 77, null, "2026-2027"]);
  });

  it("lists pasted Student IDs that match no Student or no active Mapping", async () => {
    signedInAs(ADMIN);
    db.query.mockImplementation(async (sql: string) =>
      sql.includes("unnest")
        ? [
            { student_id: "01234567890", found: true, mapped: true },
            { student_id: "99999999", found: false, mapped: false },
            { student_id: "0012345678", found: true, mapped: false },
          ]
        : [{ count: 1 }]
    );

    const res = await preview({ kind: "students", studentIds: "01234567890, 99999999\n0012345678" });

    expect(await res.json()).toEqual({ count: 1, notFound: ["99999999"], noMentor: ["0012345678"] });
  });

  it("is a 422 for an incomplete target and a 403 for a Mentor", async () => {
    signedInAs(ADMIN);
    expect((await preview({ kind: "grade", grade: 11 })).status).toBe(422);
    expect((await preview({ kind: "students", studentIds: " , " })).status).toBe(422);
    expect((await preview("nope")).status).toBe(422);
    signedInAs(MENTOR);
    expect((await preview({ kind: "all" })).status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});
