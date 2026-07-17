import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession } = vi.hoisted(() => ({ mockGetServerSession: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import { query, withTransaction } from "@/lib/db";
import { GET, PATCH, POST } from "./route";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);

describe("/api/holistic-mentorship/phase-plans", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated reads before database access", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans?academic_year=2026-2027"));

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

    const response = await GET(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans?academic_year=2026-2028"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid Academic Year" });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("lets a Holistic Mentorship Admin create the blank current-year Plan", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "hm-admin@example.com" } });
    mockQuery
      .mockResolvedValueOnce([{
        email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
        school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: 9,
      }])
      .mockResolvedValueOnce([{ id: "9" }]);
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: "7" }] }) };
    mockWithTransaction.mockImplementation(async (fn) => fn(client as never));

    const response = await POST(new NextRequest("http://localhost/api/holistic-mentorship/phase-plans", {
      method: "POST",
      body: JSON.stringify({ action: "create", academic_year: "2026-2027" }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: 7 });
    expect(client.query.mock.calls[0][1]).toEqual([1, "2026-2027"]);
  });

  it("attributes an opened Phase definition update to the authenticated actor", async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: "hm-admin@example.com" } });
    mockQuery
      .mockResolvedValueOnce([{
        email: "hm-admin@example.com", level: 3, role: "holistic_mentorship_admin",
        school_codes: null, regions: null, program_ids: [1], read_only: false, user_id: 9,
      }])
      .mockResolvedValueOnce([{ id: "9" }]);
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{
          id: "21", phase_plan_id: "7", position: 1, revision: 2, state: "open",
          guidance_markdown: "Old Guidance", academic_year: "2026-2027", frozen_at: null,
          ever_opened: true, used: false,
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
    expect(client.query.mock.calls.at(-1)?.[1]).toEqual([7, 21, "definition_updated", 9]);
  });
});
