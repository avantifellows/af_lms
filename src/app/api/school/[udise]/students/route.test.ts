import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockQuery,
  mockRequireStudentAdditionAccess,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockQuery: vi.fn(),
  mockRequireStudentAdditionAccess: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/student-addition-access", () => ({
  requireStudentAdditionAccess: mockRequireStudentAdditionAccess,
}));

import { POST } from "./route";
import { PROGRAM_IDS } from "@/lib/constants";
import {
  jsonRequest,
  routeParams,
  ADMIN_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const school = {
  id: "school-1",
  code: "JNV001",
  udise_code: "12345678901",
  region: "South",
  program_ids: [PROGRAM_IDS.NVS],
};

const validBody = {
  grade: "11",
  student_name: " asha  k. kumar ",
  date_of_birth: "02/01/2010",
  gender: "Female",
  category: "Gen",
  physically_handicapped: "No",
  apaar_id: "123456789012",
  g10_board: "CENTRAL BOARD OF SECONDARY EDUCATION",
  g10_roll_no: "1234 5678",
  board_stream: "PCM",
  stream: "Engineering",
  father_name: "Ravi Kumar",
  phone: "9876543210",
  annual_family_income: "Less than Rs. 1,00,000",
  school_code: "CLIENT-SCHOOL",
  program_id: 1,
  batch_id: "CLIENT-BATCH",
};

describe("POST /api/school/[udise]/students", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T03:00:00Z"));
    vi.resetAllMocks();
    process.env.DB_SERVICE_URL = "https://db.example.test";
    process.env.DB_SERVICE_TOKEN = "token";
    vi.stubGlobal("fetch", vi.fn());
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([school]);
    mockRequireStudentAdditionAccess.mockResolvedValue({
      ok: true,
      programId: PROGRAM_IDS.NVS,
      permission: { role: "admin" },
      actor: {
        user_id: 501,
        email: "admin@avantifellows.org",
        login_type: "google",
        role: "admin",
      },
    });
  });

  it("derives ownership fields server-side and proxies one normalized row to DB Service", async () => {
    const dbResponse = {
      totals: { total: 1, created: 1, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
      results: [{ row_number: 1, status: "created", generated_student_id: "202812345678" }],
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(dbResponse), { status: 200 }),
    );

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(dbResponse);
    expect(mockRequireStudentAdditionAccess).toHaveBeenCalledWith(ADMIN_SESSION, school);
    expect(fetch).toHaveBeenCalledWith(
      "https://db.example.test/api/lms/students/bulk-create-with-enrollments",
      expect.objectContaining({ method: "POST" }),
    );

    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload).toMatchObject({
      actor: {
        user_id: 501,
        email: "admin@avantifellows.org",
        login_type: "google",
        role: "admin",
      },
      school: { code: "JNV001", udise_code: "12345678901" },
      program_id: PROGRAM_IDS.NVS,
      academic_year: "2026-2027",
      start_date: "2026-07-01",
      rows: [
        {
          row_number: 1,
          grade: 11,
          student_name: "Asha K Kumar",
          g10_roll_no: "12345678",
          stream: "engineering",
        },
      ],
    });
    expect(payload.rows[0]).not.toHaveProperty("school_code");
    expect(payload.rows[0]).not.toHaveProperty("program_id");
    expect(payload.rows[0]).not.toHaveProperty("batch_id");
  });

  it("returns the shared gate status before calling DB Service", async () => {
    mockRequireStudentAdditionAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns rejected row details when local validation fails", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: { ...validBody, apaar_id: "", g10_roll_no: "" },
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      totals: { total: 1, rejected: 1 },
      results: [
        {
          status: "rejected",
          row_errors: ["APAAR ID or Grade 10 Roll no is required"],
        },
      ],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces DB Service errors without swallowing details", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("No matching batch found", { status: 422 }));

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Failed to create student",
      details: "No matching batch found",
    });
  });
});
