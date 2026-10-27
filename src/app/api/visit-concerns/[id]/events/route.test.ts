import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGetResolvedPermission, mockQuery, mockWithTransaction } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetResolvedPermission: vi.fn(),
  mockQuery: vi.fn(),
  mockWithTransaction: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// The real permission matrix decides access; only the permission lookup is stubbed.
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getResolvedPermission: mockGetResolvedPermission,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: mockWithTransaction }));

import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";
import { POST } from "./route";

function post(id: string, body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/visit-concerns/x/events", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    routeParams({ id })
  );
}

const ADMIN = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  read_only: false,
  program_ids: [1],
};

function signIn(permission: Record<string, unknown> | null, email = "admin@avantifellows.org") {
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockGetResolvedPermission.mockResolvedValue(permission);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/visit-concerns/[id]/events", () => {
  it("is 401 without a session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await post("9004801", { action: "resolve", body: "Fixed" });

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a read_only admin", { ...ADMIN, read_only: true }],
    ["a teacher (no visits access)", { ...ADMIN, level: 1, role: "teacher", school_codes: ["SC001"] }],
    ["a PM without a visit-manager seat (no Visit Summary)", { ...ADMIN, role: "program_manager" }],
    ["an email with no permission row", null],
  ])("is 403 for %s, before reading the body or the concern", async (_label, permission) => {
    signIn(permission);

    const res = await post("9004801", { action: "resolve", body: "Fixed" });

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-integer id", "x", { action: "resolve", body: "Fixed" }],
    ["a fractional id", "1.5", { action: "resolve", body: "Fixed" }],
    ["a zero id", "0", { action: "resolve", body: "Fixed" }],
    ["an unknown action", "9004801", { action: "dismiss", body: "Fixed" }],
    ["a missing action", "9004801", { body: "Fixed" }],
    ["a body that isn't a string", "9004801", { action: "resolve", body: 42 }],
    ["a missing body", "9004801", { action: "resolve" }],
    ["an empty body", "9004801", { action: "comment", body: "" }],
    ["a whitespace-only body", "9004801", { action: "reopen", body: "   \n\t " }],
    ["a 2001-character body", "9004801", { action: "resolve", body: "a".repeat(2001) }],
    ["a body that isn't JSON", "9004801", "not json"],
  ])("is 400 for %s, before reading the concern", async (_label, id, body) => {
    signIn(ADMIN);

    const res = await post(id, body);

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("is 404 when the concern isn't one the actor can see on the Visit Summary, without writing", async () => {
    // Missing, outside the actor's summary scope, at a School with no active physical Centre, or
    // with no live mention: the lookup finds nothing either way.
    signIn(ADMIN);
    mockQuery.mockResolvedValue([]);

    const res = await post("9004801", { action: "resolve", body: "Fixed" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Concern not found" });
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([9004801]));
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("looks the concern up only within a seated PM's visit-managed Schools", async () => {
    signIn(
      { ...ADMIN, email: "pm@avantifellows.org", role: "program_manager", scope: { visitManagedSchools: new Set(["VSWCONA"]) } },
      "pm@avantifellows.org"
    );
    mockQuery.mockResolvedValue([]);

    const res = await post("9004801", { action: "resolve", body: "Fixed" });

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([["VSWCONA"]]));
  });

  describe("on a visible concern", () => {
    // The transaction's client. The row-locking read answers with `locked`; writes answer nothing.
    let client: { query: ReturnType<typeof vi.fn> };

    function lockedConcern(locked: { kind: "concern" | "highlight"; status: "open" | "resolved" | null }) {
      client = {
        query: vi.fn(async (sql: string) => (/FOR UPDATE/.test(sql) ? { rows: [{ id: "9004801", ...locked }] } : { rows: [] })),
      };
      mockWithTransaction.mockImplementation((fn: (c: typeof client) => unknown) => fn(client));
    }

    function writesIn(calls: unknown[][]): string[] {
      return calls.map(([sql]) => String(sql)).filter((sql) => /^\s*(INSERT|UPDATE|DELETE)/i.test(sql));
    }

    beforeEach(() => {
      signIn(ADMIN);
      mockQuery.mockImplementation(async (sql: string) =>
        sql.includes("FROM lms_visit_concerns c") ? [{ id: "9004801", school_code: "VSWCONA" }] : []
      );
    });

    it.each([
      ["resolve on a highlight", "resolve", { kind: "highlight", status: null }],
      ["comment on a highlight", "comment", { kind: "highlight", status: null }],
      ["resolve on a resolved concern", "resolve", { kind: "concern", status: "resolved" }],
      ["comment on an open concern", "comment", { kind: "concern", status: "open" }],
      ["reopen on an open concern", "reopen", { kind: "concern", status: "open" }],
    ] as const)("is 409 for %s, and writes nothing", async (_label, action, locked) => {
      lockedConcern(locked);

      const res = await post("9004801", { action, body: "A note" });

      expect(res.status).toBe(409);
      expect((await res.json()).error).toEqual(expect.any(String));
      expect(writesIn(client.query.mock.calls)).toEqual([]);
      expect(writesIn(mockQuery.mock.calls)).toEqual([]);
    });

    // After commit, the route reads the concern's status and history back for the response.
    function afterCommit(status: "open" | "resolved", events: Array<Record<string, unknown>>) {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("lms_visit_concern_events")) return events;
        if (sql.includes("centres")) return [{ id: "9004801", school_code: "VSWCONA" }];
        return [{ id: "9004801", status }];
      });
    }

    const RESOLVED_EVENT = {
      concern_id: "9004801",
      kind: "resolved",
      body: "Lab kits delivered",
      author_email: "admin@avantifellows.org",
      author_name: "Admin User",
      visit_id: null,
      visit_date: null,
      at: new Date("2026-10-27T10:00:00Z"),
    };

    it("resolves an open concern: locks it, sets it resolved and appends the explanation, in one transaction", async () => {
      lockedConcern({ kind: "concern", status: "open" });
      afterCommit("resolved", [RESOLVED_EVENT]);

      const res = await post("9004801", { action: "resolve", body: "  Lab kits delivered \n" });

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        id: 9004801,
        status: "resolved",
        reopened: false,
        history: [{
          kind: "resolved",
          body: "Lab kits delivered",
          authorEmail: "admin@avantifellows.org",
          authorName: "Admin User",
          visitId: null,
          visitDate: null,
          at: "2026-10-27T10:00:00.000Z",
        }],
      });

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
      const [lock, ...rest] = client.query.mock.calls;
      expect(lock).toEqual([expect.stringMatching(/FOR UPDATE/), [9004801]]);
      expect(rest).toEqual([
        [expect.stringMatching(/^\s*UPDATE lms_visit_concerns/), [9004801, "resolved"]],
        [expect.stringMatching(/^\s*INSERT INTO lms_visit_concern_events/), [9004801, "resolved", "Lab kits delivered", "admin@avantifellows.org"]],
      ]);
      // Nothing is written outside the transaction.
      expect(writesIn(mockQuery.mock.calls)).toEqual([]);
    });

    it("comments on a resolved concern without changing its status", async () => {
      lockedConcern({ kind: "concern", status: "resolved" });
      afterCommit("resolved", [RESOLVED_EVENT, {
        ...RESOLVED_EVENT, kind: "comment", body: "Checked again", at: new Date("2026-10-27T11:00:00Z"),
      }]);

      const res = await post("9004801", { action: "comment", body: "Checked again" });

      expect(res.status).toBe(201);
      const card = await res.json();
      expect(card.status).toBe("resolved");
      expect(card.history.map((entry: { kind: string }) => entry.kind)).toEqual(["resolved", "comment"]);
      expect(writesIn(client.query.mock.calls)).toEqual([expect.stringMatching(/^\s*INSERT INTO lms_visit_concern_events/)]);
      expect(client.query).toHaveBeenLastCalledWith(
        expect.any(String),
        [9004801, "comment", "Checked again", "admin@avantifellows.org"]
      );
    });

    it("reopens a resolved concern with the reason, marking it reopened", async () => {
      lockedConcern({ kind: "concern", status: "resolved" });
      afterCommit("open", [RESOLVED_EVENT, {
        ...RESOLVED_EVENT, kind: "reopened", body: "Kits went missing again", at: new Date("2026-10-27T11:00:00Z"),
      }]);

      const res = await post("9004801", { action: "reopen", body: "Kits went missing again" });

      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ id: 9004801, status: "open", reopened: true });
      expect(client.query.mock.calls.slice(1)).toEqual([
        [expect.stringMatching(/^\s*UPDATE lms_visit_concerns/), [9004801, "open"]],
        [expect.stringMatching(/^\s*INSERT INTO lms_visit_concern_events/), [9004801, "reopened", "Kits went missing again", "admin@avantifellows.org"]],
      ]);
    });

    it("accepts a 2000-character body (the limit) and stores the author's email in lower case", async () => {
      signIn(ADMIN, "Admin@AvantiFellows.org");
      lockedConcern({ kind: "concern", status: "open" });
      afterCommit("resolved", [RESOLVED_EVENT]);
      const body = "b".repeat(2000);

      const res = await post("9004801", { action: "resolve", body: `  ${body}  ` });

      expect(res.status).toBe(201);
      expect(client.query).toHaveBeenLastCalledWith(
        expect.any(String),
        [9004801, "resolved", body, "admin@avantifellows.org"]
      );
    });
  });
});
