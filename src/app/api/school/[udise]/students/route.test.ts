import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

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

import { GET, POST } from "./route";
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

const uploadHeaders = [
  "Grade",
  "Student Name",
  "Date of Birth",
  "Gender",
  "Category",
  "Physical Handicapped / Vikalang",
  "APAAR ID",
  "G10 board",
  "Grade 10 Roll no",
  "Board Stream",
  "Primary Exam preparing for",
  "Father Name",
  "Parents Phone Number",
  "Yearly / Annual Family Income",
];

const validUploadRow = [
  "11",
  " asha  k. kumar ",
  "02/01/2010",
  "Female",
  "Gen",
  "No",
  "123456789012",
  "CENTRAL BOARD OF SECONDARY EDUCATION",
  "1234 5678",
  "PCM",
  "Engineering",
  "ravi kumar",
  "9876543210",
  "Less than Rs. 1,00,000",
];

function csvLine(values: string[]) {
  return values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",");
}

function multipartUploadRequest(filename: string, contents: string, grade = "11") {
  const bytes = Buffer.from(contents);
  const file = {
    name: filename,
    type: "text/csv",
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
  return {
    headers: new Headers({ "content-type": "multipart/form-data; boundary=test" }),
    formData: async () => ({
      get: (key: string) => (key === "grade" ? grade : key === "file" ? file : null),
    }),
  };
}

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

  it("validates the full upload before sending accepted rows to DB Service", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          upload_id: "upload-1",
          totals: { total: 1, created: 1, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
          results: [{ row_number: 2, status: "created", generated_student_id: "202812345678" }],
        }),
        { status: 200 },
      ),
    );
    const csv = [
      csvLine(uploadHeaders),
      csvLine(validUploadRow),
      csvLine([...validUploadRow.slice(0, 10), "Not A Stream", ...validUploadRow.slice(11)]),
    ].join("\n");

    const response = await POST(
      multipartUploadRequest("students.csv", csv) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.totals).toEqual({
      total: 2,
      created: 1,
      duplicate_in_file: 0,
      already_exists: 0,
      rejected: 1,
    });
    expect(body.results).toEqual([
      expect.objectContaining({
        row_number: 2,
        status: "created",
        original: expect.objectContaining({ "Student Name": "asha  k. kumar" }),
      }),
      expect.objectContaining({
        row_number: 3,
        status: "rejected",
        field_errors: { stream: "Primary Exam preparing for is not valid" },
        original: expect.objectContaining({ "Primary Exam preparing for": "Not A Stream" }),
      }),
    ]);

    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload.upload.filename).toBe("students.csv");
    expect(payload.rows).toEqual([
      expect.objectContaining({
        row_number: 2,
        student_name: "Asha K Kumar",
        stream: "engineering",
      }),
    ]);
  });
});

describe("GET /api/school/[udise]/students template", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it("returns a gated xlsx template with the canonical upload columns", async () => {
    const response = await GET(
      new Request("http://localhost/api/school/12345678901/students") as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Template, {
      header: 1,
      raw: false,
    }) as string[][];
    expect(rows[0]).toEqual(uploadHeaders);
    expect(workbook.SheetNames).toContain("Options");
  });
});
