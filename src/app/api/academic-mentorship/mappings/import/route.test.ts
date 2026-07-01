import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { GET, POST } from "./route";
import { PROGRAM_IDS } from "@/lib/constants";

const mockQuery = vi.mocked(query);
const mockWithTransaction = vi.mocked(withTransaction);

function request(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function csvUploadRequest(csvText: string) {
  const formData = new FormData();
  formData.set("school_code", "SCH001");
  formData.set("academic_year", "2026-2027");
  formData.set("file", new Blob([csvText], { type: "text/csv" }), "mappings.csv");
  return { formData: async () => formData } as unknown as NextRequest;
}

describe("GET /api/academic-mentorship/mappings/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it("downloads the CSV template for editable users", async () => {
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
      ]);

    const response = await GET(
      request(
        "/api/academic-mentorship/mappings/import?school_code=SCH001&academic_year=2026-2027"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("mentor_email,student_id\n");
    expect(response.headers.get("content-disposition")).toContain(
      "academic-mentorship-template.csv"
    );
  });

  it("denies read-only users before template download", async () => {
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
      request(
        "/api/academic-mentorship/mappings/import?school_code=SCH001&academic_year=2026-2027"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/academic-mentorship/mappings/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockWithTransaction.mockReset();
  });

  it("bulk imports a valid CSV for editable users", async () => {
    const txQuery = vi.fn().mockResolvedValueOnce({ rows: [{ id: 31 }] });
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
      .mockResolvedValueOnce([{ email: "anita@avantifellows.org", user_id: 101 }])
      .mockResolvedValueOnce([
        {
          student_id: "STU001",
          student_pk_id: 201,
          program_id: 64,
          active_mapping_id: null,
        },
      ]);
    mockWithTransaction.mockImplementationOnce(async (callback) =>
      callback({ query: txQuery } as never)
    );

    const response = await POST(
      csvUploadRequest("mentor_email,student_id\nANITA@AVANTIFELLOWS.ORG, STU001 \n")
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ success: true, insertedCount: 1 });
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns file-level CSV errors without an error CSV", async () => {
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
      ]);

    const response = await POST(csvUploadRequest("mentor_email,name\nanita@x,Meena\n"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "CSV must include mentor_email and student_id headers",
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns row-level CSV errors with downloadable CSV contents", async () => {
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
      .mockResolvedValueOnce([{ email: "anita@x", user_id: 101 }])
      .mockResolvedValueOnce([]);

    const response = await POST(
      csvUploadRequest("mentor_email,student_id,notes\nanita@x,,missing\n")
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      error: "CSV upload has row errors",
      errors: [{ rowNumber: 2, field: "student_id", error: "student_id is required" }],
    });
    expect(body.errorCsv).toContain("mentor_email,student_id,notes,error_reason");
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("returns 401 before database access", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await POST(
      csvUploadRequest("mentor_email,student_id\nanita@x,STU001\n")
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });
});
