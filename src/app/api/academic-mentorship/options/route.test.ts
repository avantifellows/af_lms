import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/db";
import { GET } from "./route";
import { PROGRAM_IDS } from "@/lib/constants";

const mockQuery = vi.mocked(query);

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe("GET /api/academic-mentorship/options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it("returns searchable Academic Mentor options after edit access is granted", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });
    mockQuery
      .mockResolvedValueOnce([
        {
          email: "admin@avantifellows.org",
          level: 3,
          role: "admin",
          school_codes: null,
          regions: null,
          program_ids: [PROGRAM_IDS.NVS],
          read_only: false,
          user_id: 501,
        },
      ])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      ])
      .mockResolvedValueOnce([
        {
          user_id: 101,
          name: "Anita Mentor",
          email: "anita@avantifellows.org",
        },
      ]);

    const response = await GET(
      request("/api/academic-mentorship/options?type=mentors&school_code=SCH001&q=anita")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.options).toEqual([
      {
        userId: 101,
        name: "Anita Mentor",
        email: "anita@avantifellows.org",
      },
    ]);
    const optionCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM teacher t")
    );
    expect(optionCall?.[1]).toEqual(["SCH001", "North", 20, "%anita%"]);
  });

  it("returns searchable Mentee options for the selected academic year", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });
    mockQuery
      .mockResolvedValueOnce([
        {
          email: "admin@avantifellows.org",
          level: 3,
          role: "admin",
          school_codes: null,
          regions: null,
          program_ids: [PROGRAM_IDS.NVS],
          read_only: false,
          user_id: 501,
        },
      ])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      ])
      .mockResolvedValueOnce([
        {
          student_pk_id: 201,
          name: "Meena Student",
          student_id: "STU001",
          grade: 11,
          program_id: 64,
        },
      ]);

    const response = await GET(
      request(
        "/api/academic-mentorship/options?type=mentees&school_code=SCH001&academic_year=2026-2027&q=STU"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.options).toEqual([
      {
        studentPkId: 201,
        name: "Meena Student",
        studentId: "STU001",
        grade: 11,
        programId: 64,
      },
    ]);
    const optionCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("active_mapping.id IS NULL")
    );
    expect(optionCall?.[1]).toEqual([20, "2026-2027", "%STU%"]);
  });

  it("returns 401 before database access when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(
      request("/api/academic-mentorship/options?type=mentors&school_code=SCH001")
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects read-only users before exposing selector options", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "readonly@avantifellows.org" },
    });
    mockQuery.mockResolvedValueOnce([
      {
        email: "readonly@avantifellows.org",
        level: 3,
        role: "program_admin",
        school_codes: null,
        regions: null,
        program_ids: [PROGRAM_IDS.NVS],
        read_only: true,
        user_id: 501,
      },
    ]);

    const response = await GET(
      request("/api/academic-mentorship/options?type=mentors&school_code=SCH001")
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
