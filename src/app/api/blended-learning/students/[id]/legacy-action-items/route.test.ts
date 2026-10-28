import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { MAPPING, MENTOR, READ_ONLY_ADMIN, mockBlendedDb, signedInAs } from "@/app/api/blended-learning/test-db";
import { POST } from "./route";

// Synthetic item only.
const TICK = { index: 1, text: "Synthetic: revise optics", owner: "student", done: true };
const DONE_ITEM = { text: TICK.text, owner: "student", done_at: "2026-10-27T09:00:00+05:30", done_by_email: MENTOR.actorEmail };

let query: ReturnType<typeof mockBlendedDb>["query"];

async function post(studentId: string, body: unknown) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/students/${studentId}/legacy-action-items`, { method: "POST", body }),
    routeParams({ id: studentId })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  ({ query } = mockBlendedDb());
  signedInAs(MENTOR);
});

describe("POST /api/blended-learning/students/[id]/legacy-action-items", () => {
  it("lets the Student's own Mentor tick an item, in one guarded UPDATE", async () => {
    query.mockResolvedValueOnce([MAPPING]).mockResolvedValueOnce([{ item: DONE_ITEM }]);

    const res = await post("501", TICK);

    expect(res).toEqual({
      status: 200,
      body: {
        item: { index: 1, text: TICK.text, owner: "student", doneAt: DONE_ITEM.done_at, doneByEmail: MENTOR.actorEmail },
      },
    });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain("jsonb_set");
    expect(sql).toContain("->> 'text' = $3");
    expect(sql).toContain("->> 'owner' = $4");
    expect(sql).toContain("updated_at = now()");
    expect(params).toEqual([501, 1, TICK.text, "student", true, MENTOR.actorEmail]);
  });

  it("unticks an item", async () => {
    query.mockResolvedValueOnce([MAPPING]).mockResolvedValueOnce([{ item: { ...DONE_ITEM, done_at: null, done_by_email: null } }]);

    const res = await post("501", { ...TICK, done: false });

    expect(res.body.item).toMatchObject({ doneAt: null, doneByEmail: null });
    expect(query.mock.calls[1][1]).toEqual([501, 1, TICK.text, "student", false, MENTOR.actorEmail]);
  });

  it("is a 409 when the item at that index no longer has that text and owner", async () => {
    query.mockResolvedValueOnce([MAPPING]).mockResolvedValueOnce([]);
    expect(await post("501", TICK)).toEqual({
      status: 409,
      body: { error: "These Profile Doc items have changed. Reload the page." },
    });
  });

  it("refuses another Mentor's Student with 403, without writing", async () => {
    query.mockResolvedValueOnce([{ ...MAPPING, mentor_user_id: 9002 }]);
    expect((await post("501", TICK)).status).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a read-only Blended Learning Admin", READ_ONLY_ADMIN],
    ["a Blended Learning Admin", { ...READ_ONLY_ADMIN, readOnly: false }],
    ["a read-only Mentor", { ...MENTOR, readOnly: true }],
  ])("refuses %s with 403", async (_label, who) => {
    signedInAs(who);
    expect((await post("501", TICK)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("is a 401 signed out", async () => {
    signedInAs(null);
    expect((await post("501", TICK)).status).toBe(401);
  });

  it.each([
    ["no index", { ...TICK, index: undefined }],
    ["an index past ten items", { ...TICK, index: 10 }],
    ["a fractional index", { ...TICK, index: 1.5 }],
    ["an unknown owner", { ...TICK, owner: "teacher" }],
    ["no text", { ...TICK, text: 3 }],
    ["no done", { ...TICK, done: "yes" }],
    ["a list", [TICK]],
  ])("is a 422 for %s", async (_label, body) => {
    expect((await post("501", body)).status).toBe(422);
    expect(query).not.toHaveBeenCalled();
  });

  it("is a 422 for a body that is not JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/blended-learning/students/501/legacy-action-items", { method: "POST", body: "{" }),
      routeParams({ id: "501" })
    );
    expect(res.status).toBe(422);
  });
});
