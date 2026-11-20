import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession } = vi.hoisted(() => ({ mockGetServerSession: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "@/lib/db";
import { HOLISTIC_CLOSING_PHASE_CHANGED_ERROR } from "@/lib/holistic-phase-messages";
import { GET, PATCH, POST } from "./route";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);

describe("/api/holistic-mentorship/phase-plans", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["", "null", undefined])("rejects missing Phase Plan Program context (%s)", async (programId) => {
    const query = programId === undefined ? "" : `&program_id=${programId}`;
    const response = await GET(new NextRequest(
      `http://localhost/api/holistic-mentorship/phase-plans?academic_year=2026-2027${query}`,
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Program" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([{}, { program_id: null }, { program_id: "" }, { program_id: "1" }])(
    "rejects missing or non-numeric mutation Program context",
    async (program) => {
      const response = await POST(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans", {
        method: "POST",
        body: JSON.stringify({ action: "create", academic_year: "2026-2027", ...program }),
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid request body" });
      expect(mockGetServerSession).not.toHaveBeenCalled();
    },
  );

  it("rejects unauthenticated reads before database access", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans?academic_year=2026-2027&program_id=1"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a malformed Academic Year before Plan data access", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "hm-admin@example.com" } });
    mockQuery.mockResolvedValueOnce([{
      email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
      school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: 9,
    }]);

    const response = await GET(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans?academic_year=2026-2028&program_id=1"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Academic Year" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it.each(["program_manager", "program_admin"] as const)(
    "denies an in-scope %s access to Phase Setup",
    async (role) => {
    mockGetServerSession.mockResolvedValue({ user: { email: `${role}@example.com` } });
    mockQuery
      .mockResolvedValueOnce([{
        email: `${role}@example.com`, level: 3, role,
        school_codes: null, regions: null, program_ids: [1],
        read_only: false, user_id: 9,
      }])
      .mockResolvedValueOnce([{ program_id: 1 }])
      .mockResolvedValue([]);

    const response = await GET(new NextRequest(
      "http://localhost/api/holistic-mentorship/phase-plans?academic_year=2026-2027&program_id=1",
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves Phase Plan reads for a read-only Holistic Mentorship Admin", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "hm-admin@example.com" } });
    mockQuery
      .mockResolvedValueOnce([{
        email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
        school_codes: null, regions: null, program_ids: [1], read_only: true, user_id: 9,
      }])
      .mockResolvedValueOnce([]);

    const response = await GET(new NextRequest(
      "http://localhost/api/holistic-mentorship/phase-plans?academic_year=2026-2027&program_id=1",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ plan: null });
  });

  describe("what opening a Locked Phase would close", () => {
    const impactUrl = (phaseId: string) =>
      `http://localhost/api/holistic-mentorship/phase-plans?program_id=1&open_impact_phase_id=${phaseId}`;
    const admin = {
      email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
      school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: 9,
    };

    it("is denied to a Program Manager before any count is read", async () => {
      mockGetServerSession.mockResolvedValue({ user: { email: "pm@example.com" } });
      mockQuery
        .mockResolvedValueOnce([{ ...admin, email: "pm@example.com", role: "program_manager" }])
        .mockResolvedValue([]);

      const response = await GET(new NextRequest(impactUrl("16")));

      expect(response.status).toBe(403);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it.each(["abc", "0", "-3", "1.5", ""])("rejects the Phase id %j", async (phaseId) => {
      mockGetServerSession.mockResolvedValue({ user: { email: admin.email } });
      mockQuery.mockResolvedValueOnce([admin]);

      const response = await GET(new NextRequest(impactUrl(phaseId)));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid Phase" });
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("is not found for a Phase outside the Program or not Locked", async () => {
      mockGetServerSession.mockResolvedValue({ user: { email: admin.email } });
      mockQuery.mockResolvedValueOnce([admin]).mockResolvedValueOnce([]);

      const response = await GET(new NextRequest(impactUrl("16")));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Phase not found" });
    });

    it("returns counts only for the Phase that will close", async () => {
      mockGetServerSession.mockResolvedValue({ user: { email: admin.email } });
      mockQuery
        .mockResolvedValueOnce([admin])
        .mockResolvedValueOnce([{ phase_plan_id: "7", grade_id: "3", grade: "12", position: 4, academic_year: "2026-2027" }])
        .mockResolvedValueOnce([{ id: "15", number: "2" }])
        .mockResolvedValueOnce([{ without_notes: "45", drafts: "1" }]);

      const response = await GET(new NextRequest(impactUrl("16")));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        impact: { closing: { id: 15, number: 2, menteesWithoutNotes: 45, unsubmittedDrafts: 1 } },
      });
      expect(mockQuery.mock.calls[1][1]).toEqual([16, 1, "2026-2027"]);
    });
  });

  describe("opening a Phase with the Phase the Admin was told would close", () => {
    const hmAdmin = {
      email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
      school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: 9,
    };
    const open = (extra: Record<string, unknown>) => PATCH(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "state", program_id: 1, phase_id: 21, expected_revision: 2, state: "open", confirmed: true, ...extra }),
    }));

    it.each(["15", 0, -3, 1.5, true, {}])("rejects a malformed expected_closing_phase_id (%j) before any write", async (value) => {
      mockGetServerSession.mockResolvedValue({ user: { email: hmAdmin.email } });
      mockQuery.mockResolvedValueOnce([hmAdmin]);

      const response = await open({ expected_closing_phase_id: value });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid state change" });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it.each([
      ["a Phase id", 15, [{ id: "18" }]],
      ["null, meaning no Phase closes", null, [{ id: "15" }]],
    ] as const)("answers 409 when it was %s and a different Phase would close now", async (_name, expected, closingNow) => {
      mockGetServerSession.mockResolvedValue({ user: { email: hmAdmin.email } });
      mockQuery.mockResolvedValueOnce([hmAdmin]);
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: "7" }] })
          .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [...closingNow] }),
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

      const response = await open({ expected_closing_phase_id: expected });

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: HOLISTIC_CLOSING_PHASE_CHANGED_ERROR });
      expect(client.query).toHaveBeenCalledTimes(4);
    });

    it("does not run the check when the screen sent no expected_closing_phase_id", async () => {
      mockGetServerSession.mockResolvedValue({ user: { email: hmAdmin.email } });
      mockQuery.mockResolvedValueOnce([hmAdmin]);
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: "7" }] })
          .mockResolvedValueOnce({ rows: [{ id: "21", revision: 2, state: "locked", academic_year: "2026-2027", frozen_at: null, ever_opened: false, used: false }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ grade: "11", title: "Belonging", guidance_markdown: "Discuss goals", question_count: "1", valid_question_count: "1" }] })
          .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

      const response = await open({});

      expect(response.status).toBe(200);
      expect(client.query).toHaveBeenCalledTimes(6);
    });
  });

  describe("reordering Phases", () => {
    const hmAdmin = {
      email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
      school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: 9,
    };
    const reorder = (phases: unknown) => PATCH(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans", {
      method: "PATCH",
      body: JSON.stringify({ action: "reorder", program_id: 1, academic_year: "2026-2027", phases }),
    }));

    it.each([
      ["not a list", "21,22"],
      ["an entry that is not an object", [null]],
      ["an entry without a revision", [{ id: 21 }]],
      ["an id sent as text", [{ id: "21", expected_revision: 1 }]],
    ])("rejects a Phase order with %s before any write", async (_name, phases) => {
      mockGetServerSession.mockResolvedValue({ user: { email: hmAdmin.email } });
      mockQuery.mockResolvedValueOnce([hmAdmin]);

      const response = await reorder(phases);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid Phase order" });
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("passes a well-formed order to the Plan, which locks the Plan row first", async () => {
      mockGetServerSession.mockResolvedValue({ user: { email: hmAdmin.email } });
      mockQuery.mockResolvedValueOnce([hmAdmin]);
      const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

      const response = await reorder([{ id: 22, expected_revision: 1 }, { id: 21, expected_revision: 2 }]);

      // The Plan lock found no Plan for the year, so nothing is read or moved.
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("Phase order changed");
      expect(client.query).toHaveBeenCalledOnce();
      expect(client.query.mock.calls[0][1]).toEqual([1, "2026-2027"]);
      expect(String(client.query.mock.calls[0][0])).toContain("FOR UPDATE");
    });
  });

  it("lets a Holistic Mentorship Admin create the blank current-year Plan", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "hm-admin@example.com" } });
    mockQuery.mockResolvedValueOnce([{
      email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
      school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: 9,
    }]);
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: "7" }] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    const response = await POST(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans", {
      method: "POST",
      body: JSON.stringify({ action: "create", academic_year: "2026-2027", program_id: 1 }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 7 });
    expect(client.query.mock.calls[0][1]).toEqual([1, "2026-2027"]);
  });

  it("attributes a Phase update by email when the actor has no User row", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "hm-admin@example.com" } });
    mockQuery.mockResolvedValueOnce([{
      email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
      school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: null,
    }]);
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "7" }] }) // Plan lock, taken before the Phase row
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", position: 1, revision: 2, state: "open",
          guidance_markdown: "Old Guidance", academic_year: "2026-2027", frozen_at: null,
          grade: "12", ever_opened: true, used: false,
        }] })
        .mockResolvedValueOnce({ rows: [{ id: "41" }] })
        .mockResolvedValueOnce({ rows: [{ revision: 3 }] })
        .mockResolvedValue({ rows: [] }),
    };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    const response = await PATCH(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans", {
      method: "PATCH",
      body: JSON.stringify({
        action: "update",
        program_id: 1,
        phase_id: 21,
        expected_revision: 2,
        confirmed: true,
        grade: 12,
        title: "New title",
        guidance_markdown: "New Guidance",
        questions: [{ id: 41, text: "New Question" }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(client.query.mock.calls.at(-1)?.[1]).toEqual([
      7, 21, "definition_updated", null, "hm-admin@example.com",
    ]);
  });
});
