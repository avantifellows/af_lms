import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

import { query, withTransaction } from "@/lib/db";
import { DELETE, GET, PATCH, POST } from "./route";
import { PROGRAM_IDS } from "@/lib/constants";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

describe("GET /api/academic-mentorship/mappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
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

  it("rejects Teachers from the full-school mapping API", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "teacher@avantifellows.org" },
    });
    mockQuery
      .mockResolvedValueOnce([
        {
          email: "teacher@avantifellows.org",
          level: 1,
          role: "teacher",
          school_codes: ["SCH001"],
          regions: null,
          program_ids: [PROGRAM_IDS.NVS],
          read_only: false,
          user_id: null,
        },
      ])
      .mockResolvedValueOnce([
        { id: 20, code: "SCH001", name: "Mapped School", region: "North" },
      ]);

    const response = await GET(
      request(
        "/api/academic-mentorship/mappings?school_code=SCH001&academic_year=2026-2027&include_history=true"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("academic_mentorship_mentor_mentee_mappings")
      )
    ).toBe(false);
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
          program_id: PROGRAM_IDS.NVS,
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
    expect(mappingCall?.[1]).toEqual([20, "2026-2027", false, null]);
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
          program_id: PROGRAM_IDS.NVS,
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
    expect(mappingCall?.[1]).toEqual([20, "2026-2027", true, null]);
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

describe("POST /api/academic-mentorship/mappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it("creates a Mapping for editable users", async () => {
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
      .mockResolvedValueOnce([{ user_id: 101 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ student_pk_id: 201, program_id: null }])
      .mockResolvedValueOnce([{ id: 7 }]);

    const response = await POST(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mentor_user_id: 101,
          student_id: 201,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ success: true, mappingId: 7 });
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO academic_mentorship_mentor_mentee_mappings")
    );
    expect(insertCall?.[1]).toEqual([
      20,
      "2026-2027",
      101,
      201,
      null,
      501,
    ]);
  });

  it("denies read-only users before write queries", async () => {
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

    const response = await POST(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mentor_user_id: 101,
          student_id: 201,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("maps active uniqueness races to the expected conflict message", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });
    const duplicateError = new Error("duplicate key value violates unique constraint");
    Object.assign(duplicateError, { code: "23505" });
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
      .mockResolvedValueOnce([{ user_id: 101 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ student_pk_id: 201, program_id: 64 }])
      .mockRejectedValueOnce(duplicateError);

    const response = await POST(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "POST",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mentor_user_id: 101,
          student_id: 201,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Student already has a mentor mapped");
  });
});

describe("DELETE /api/academic-mentorship/mappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it("ends an active Mapping for editable users", async () => {
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
      .mockResolvedValueOnce([{ id: 7 }]);

    const response = await DELETE(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "DELETE",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, mappingId: 7 });
    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE academic_mentorship_mentor_mentee_mappings")
    );
    expect(updateCall?.[1]).toEqual([7, 20, "2026-2027", 501]);
  });
});

describe("PATCH /api/academic-mentorship/mappings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it("reassigns an active Mapping for editable users", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });
    const txQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ student_id: 201, mentor_user_id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ student_pk_id: 201, program_id: 64 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] });
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
      .mockResolvedValueOnce([{ user_id: 102 }]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 102,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, mappingId: 9 });
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns 401 before database access", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 102,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns 400 when replacement mentor is missing before database access", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("mentor_user_id is required");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("denies read-only users before reassignment", async () => {
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

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 102,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects replacement mentors that are not eligible for the School", async () => {
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
      .mockResolvedValueOnce([]);

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 102,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("Academic Mentor is not eligible for this School");
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("rejects the current Academic Mentor as the replacement", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });
    const txQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ student_id: 201, mentor_user_id: 101 }] });
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
      .mockResolvedValueOnce([{ user_id: 101 }]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 101,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("Replacement Academic Mentor must be different");
  });

  it("denies inactive or historical Mappings", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });
    const txQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
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
      .mockResolvedValueOnce([{ user_id: 102 }]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 102,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Active Mapping not found");
  });

  it("maps concurrent active Mapping races to the expected conflict message", async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: "admin@avantifellows.org" },
    });
    const duplicateError = new Error("duplicate key value violates unique constraint");
    Object.assign(duplicateError, { code: "23505" });
    const txQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ student_id: 201, mentor_user_id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ student_pk_id: 201, program_id: 64 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockRejectedValueOnce(duplicateError);
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
      .mockResolvedValueOnce([{ user_id: 102 }]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const response = await PATCH(
      new NextRequest("http://localhost/api/academic-mentorship/mappings", {
        method: "PATCH",
        body: JSON.stringify({
          school_code: "SCH001",
          academic_year: "2026-2027",
          mapping_id: 7,
          mentor_user_id: 102,
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe("Student already has a mentor mapped");
  });
});
