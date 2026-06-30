import { describe, expect, it, beforeEach, vi } from "vitest";
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

describe("GET /api/academic-mentorship/mappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it("returns 401 when unauthenticated before database access", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(request("/api/academic-mentorship/mappings"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed academic_year before database access", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });

    const response = await GET(
      request("/api/academic-mentorship/mappings?school_code=SCH001&academic_year=2026")
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("academic_year must use YYYY-YYYY format");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns active grouped mappings by default", async () => {
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
          user_id: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          mentor_user_id: 101,
          mentor_name: "Anita Mentor",
          mentor_email: "anita@avantifellows.org",
          student_pk_id: 201,
          mentee_name: "Meena Student",
          mentee_student_id: "STU001",
          mentee_grade: 11,
          assigned_date: "2026-07-01",
          ended_date: null,
        },
      ]);

    const response = await GET(
      request("/api/academic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      academicYear: "2026-2027",
      includeHistory: false,
      canEdit: true,
      groups: [
        {
          mentor: { name: "Anita Mentor" },
          menteeCount: 1,
          mappings: [
            {
              mentee: { name: "Meena Student", studentId: "STU001", grade: 11 },
              assignedDate: "2026-07-01",
              status: "active",
            },
          ],
        },
      ],
    });
    const mappingCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("academic_mentorship_mentor_mentee_mappings")
    );
    expect(mappingCall?.[1]).toEqual([20, "2026-2027", false]);
  });

  it("passes include_history=true through to the mapping read", async () => {
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
          user_id: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      ])
      .mockResolvedValueOnce([
        {
          id: 2,
          mentor_user_id: 101,
          mentor_name: "Anita Mentor",
          mentor_email: "anita@avantifellows.org",
          student_pk_id: 201,
          mentee_name: "Meena Student",
          mentee_student_id: "STU001",
          mentee_grade: 11,
          assigned_date: "2026-07-01",
          ended_date: "2026-08-01",
        },
      ]);

    const response = await GET(
      request(
        "/api/academic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&include_history=true"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.includeHistory).toBe(true);
    expect(body.groups[0].mappings[0]).toMatchObject({
      endedDate: "2026-08-01",
      status: "historical",
    });
    const mappingCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("academic_mentorship_mentor_mentee_mappings")
    );
    expect(mappingCall?.[1]).toEqual([20, "2026-2027", true]);
  });

  it("returns canEdit=false for valid academic years outside the supported picker range", async () => {
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
          user_id: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(
      request("/api/academic-mentorship/mappings?school_code=SCH001&academic_year=2023-2024")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.canEdit).toBe(false);
    expect(body.academicYear).toBe("2023-2024");
  });
});
