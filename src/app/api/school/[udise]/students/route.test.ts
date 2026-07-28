import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

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
  NO_SESSION,
} from "../../../__test-utils__/api-test-helpers";

const school = {
  id: "school-1",
  code: "JNV001",
  udise_code: "12345678901",
  region: "South",
  centre_program_ids: [PROGRAM_IDS.NVS],
};

const validBody = {
  grade: "11",
  student_name: " asha  k kumar ",
  date_of_birth: "02/01/2010",
  gender: "Female",
  category: "Gen",
  physically_handicapped: "No",
  pen_number: "01234567890",
  g10_board: "CBSE",
  g10_roll_no: "12345678",
  board_stream: "PCM",
  stream: "Engineering",
  father_name: "Ravi Kumar",
  phone: "9876543210",
  annual_family_income: "Less than Rs. 1,00,000",
  school_code: "CLIENT-SCHOOL",
  program_id: 1,
  batch_id: "CLIENT-BATCH",
  student_id: "CLIENT-STUDENT-ID",
  apaar_id: "CLIENT-APAAR",
  actor: { email: "attacker@example.com" },
};

const uploadHeaders = [
  "Grade",
  "Student Name",
  "Date of Birth",
  "Gender",
  "Category",
  "CWSN",
  "PEN Number",
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
  "12345678901",
  "CBSE",
  "12345678",
  "PCM",
  "Engineering",
  "ravi kumar",
  "9876543210",
  "Less than Rs. 1,00,000",
];

function csvLine(values: string[]) {
  return values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",");
}

function multipartUploadRequest(
  filename: string,
  contents: string,
  grade: string | null = "11",
  size = Buffer.from(contents).byteLength,
) {
  const bytes = Buffer.from(contents);
  const file = {
    name: filename,
    type: "text/csv",
    size,
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
    process.env.DB_SERVICE_URL = "https://db.example.test/api";
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
    expect(mockQuery.mock.calls[0][0]).not.toContain("centres");
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
          pen_number: "01234567890",
          g10_roll_no: "12345678",
          stream: "engineering",
        },
      ],
    });
    expect(payload.rows[0]).not.toHaveProperty("school_code");
    expect(payload.rows[0]).not.toHaveProperty("program_id");
    expect(payload.rows[0]).not.toHaveProperty("batch_id");
    expect(payload.rows[0]).not.toHaveProperty("student_id");
    expect(payload.rows[0]).not.toHaveProperty("apaar_id");
    expect(payload.rows[0]).not.toHaveProperty("actor");
  });

  it("proxies revised NVS values in the canonical row", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ results: [{ status: "created" }] }), { status: 200 }),
    );

    await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: {
          ...validBody,
          gender: "Others",
          category: "ST",
          physically_handicapped: "Yes",
          g10_board: "Others",
          g10_roll_no: "00-ab12",
          stream: "NDA",
        },
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload.rows[0]).toMatchObject({
      pen_number: "01234567890",
      gender: "Other",
      category: "PWD-ST",
      physically_handicapped: true,
      g10_board: "Others",
      g10_roll_no: "AB12",
      stream: "nda",
    });
  });

  it("returns 401 before resolving schools when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(NO_SESSION);

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRequireStudentAdditionAccess).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
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
        body: { ...validBody, pen_number: "", g10_roll_no: "" },
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      totals: { total: 1, rejected: 1 },
      results: [
        {
          status: "rejected",
          row_errors: ["PEN or Grade 10 Roll no is required"],
        },
      ],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not expose raw DB Service response bodies", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("internal stack trace", { status: 422 }));

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Student could not be created",
    });
  });

  it("preserves safe structured DB Service field errors", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ field_errors: { pen_number: "PEN already exists" } }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Student could not be created",
      field_errors: { pen_number: "PEN already exists" },
    });
  });

  it("filters unsafe fields from structured DB Service results", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              status: "already_exists",
              private_token: "must-not-leak",
              existing_match: {
                student_id: "2028AB12Z",
                pen_number: "12345678901",
                internal_note: "must-not-leak",
              },
            },
            {
              status: "duplicate_in_file",
              duplicate_identifiers: ["PEN Number", 123, { unsafe: true }],
              private_token: "must-not-leak",
            },
          ],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(await response.json()).toEqual({
      error: "Student could not be created",
      results: [
        {
          status: "already_exists",
          existing_match: { student_id: "2028AB12Z", pen_number: "12345678901" },
        },
        {
          status: "duplicate_in_file",
          duplicate_identifiers: ["PEN Number"],
        },
      ],
    });
  });

  it("fails safely when DB Service configuration is missing", async () => {
    delete process.env.DB_SERVICE_URL;

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: validBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "DB Service is not configured" });
    expect(fetch).not.toHaveBeenCalled();
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
    expect(payload.academic_year).toBe("2026-2027");
    expect(payload.rows).toEqual([
      expect.objectContaining({
        row_number: 2,
        student_name: "Asha K Kumar",
        stream: "engineering",
      }),
    ]);
  });

  it("reports and removes example rows before proxying the upload", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 1, created: 1, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
          results: [{ row_number: 3, status: "created" }],
        }),
        { status: 200 },
      ),
    );
    const exampleRow = [...validUploadRow];
    exampleRow[1] = "Example Student";
    exampleRow[6] = "invalid";
    const csv = [
      csvLine(uploadHeaders),
      csvLine(exampleRow),
      csvLine(validUploadRow),
    ].join("\n");

    const response = await POST(
      multipartUploadRequest("students.csv", csv) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      totals: { total: 1, created: 1 },
      ignored_rows: [
        {
          row_number: 2,
          matched_fields: ["Student Name"],
          message: "Row 2 was ignored as the example row. Matched: Student Name.",
        },
      ],
      results: [expect.objectContaining({ row_number: 3, status: "created" })],
    });
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload.rows).toEqual([
      expect.objectContaining({ row_number: 3, student_name: "Asha K Kumar" }),
    ]);
  });

  it("stops before DB Service when the upload contains only example rows", async () => {
    const exampleRow = [...validUploadRow];
    exampleRow[1] = "Moved Example";
    exampleRow[6] = "12345678910";
    const csv = [csvLine(uploadHeaders), csvLine(exampleRow)].join("\n");

    const response = await POST(
      multipartUploadRequest("students.csv", csv) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        "No students to upload. Row 2 was ignored as the example row. Matched: PEN. Add at least one student and upload again.",
      ignored_rows: [
        {
          row_number: 2,
          matched_fields: ["PEN"],
          message: "Row 2 was ignored as the example row. Matched: PEN.",
        },
      ],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("merges structured DB Service rejects into a non-200 bulk response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{
            row_number: 2,
            status: "rejected",
            field_errors: { pen_number: "PEN already exists" },
          }],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const csv = [csvLine(uploadHeaders), csvLine(validUploadRow)].join("\n");

    const response = await POST(
      multipartUploadRequest("students.csv", csv) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Student could not be created",
      totals: {
        total: 1,
        created: 0,
        duplicate_in_file: 0,
        already_exists: 0,
        rejected: 1,
      },
      results: [expect.objectContaining({
        row_number: 2,
        status: "rejected",
        original: expect.objectContaining({ "Student Name": "asha  k. kumar" }),
      })],
    });
  });

  it("proxies mixed-grade rows without multipart Grade metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        totals: { total: 2, created: 2, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
        results: [
          { row_number: 2, status: "created" },
          { row_number: 3, status: "created" },
        ],
      }), { status: 200 }),
    );
    const grade12Row = ["12", ...validUploadRow.slice(1, 6), "12345678902", ...validUploadRow.slice(7)];
    const csv = [csvLine(uploadHeaders), csvLine(validUploadRow), csvLine(grade12Row)].join("\n");

    const response = await POST(
      multipartUploadRequest("students.csv", csv, null) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload.rows.map((row: { grade: number; pen_number: string }) => [row.grade, row.pen_number])).toEqual([
      [11, "12345678901"],
      [12, "12345678902"],
    ]);
  });

  it("rejects oversized bulk uploads before buffering the file", async () => {
    const response = await POST(
      multipartUploadRequest(
        "students.csv",
        csvLine(uploadHeaders),
        "11",
        5 * 1024 * 1024 + 1,
      ) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Upload file is too large. Max size is 5 MB.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a user-facing error for corrupt xlsx uploads", async () => {
    const response = await POST(
      multipartUploadRequest("students.xlsx", "not a real workbook") as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Upload a valid .xlsx file or rejected-row .csv file",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a user-facing error for malformed csv uploads", async () => {
    const response = await POST(
      multipartUploadRequest("students.csv", `${csvLine(uploadHeaders)}\n"unterminated`) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Upload a valid .xlsx file or rejected-row .csv file",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/school/[udise]/students template", () => {
  beforeEach(() => {
    vi.useRealTimers();
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

  it("returns the updated gated workbook with the three restored validations", async () => {
    const response = await GET(
      new Request("http://localhost/api/school/12345678901/students") as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="nvs-student-addition-template.xlsx"',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const template = workbook.getWorksheet("Template");
    expect((template?.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Grade",
      "Student Name",
      "Date of Birth",
      "Gender",
      "Category",
      "CWSN",
      "PEN Number",
      "G10 board",
      "Grade 10 Roll no",
      "Board Stream",
      "Primary Exam preparing for",
      "Father Name",
      "Parents Phone Number",
      "Yearly / Annual Family Income",
    ]);
    expect(template?.rowCount).toBe(472);
    expect(template?.getColumn(1).width).toBe(9);
    expect(template?.getCell("A1").fill).toEqual(
      expect.objectContaining({ type: "pattern", pattern: "solid" }),
    );
    expect(template?.getCell("A2").dataValidation).toEqual(
      expect.objectContaining({
        type: "list",
        formulae: ["'Dropdown values'!$A$2:$A$3"],
      }),
    );
    expect(template?.getCell("G2").dataValidation).toEqual(
      expect.objectContaining({
        type: "custom",
        formulae: [
          'AND(LEN(G2&"")=11,IFERROR(TEXT(VALUE(G2&""),"00000000000")=G2&"",FALSE))',
        ],
      }),
    );
    expect(template?.getCell("G2").numFmt).toBe("@");
    expect(template?.getCell("C2").dataValidation).toEqual(
      expect.objectContaining({
        type: "custom",
        formulae: [
          "AND(ISNUMBER(C2),C2>=DATE(2000,1,1),C2<=DATE(2015,12,31))",
        ],
      }),
    );
    expect(template?.getCell("M2").dataValidation).toEqual(
      expect.objectContaining({
        type: "custom",
        formulae: [
          'AND(LEN(M2&"")=10,LEFT(M2&"",1)<>"0",IFERROR(TEXT(VALUE(M2&""),"0000000000")=M2&"",FALSE))',
        ],
      }),
    );
    expect(template?.getCell("B2").value).toBe("Example Student");
    expect(String(template?.getCell("G2").value)).toBe("12345678910");
    expect(String(template?.getCell("I2").value)).toBe("11111111");
    expect(String(template?.getCell("M2").value)).toBe("9999999999");
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Template",
      "Dropdown values",
    ]);
    const dropdowns = workbook.getWorksheet("Dropdown values");
    expect(dropdowns?.getCell("A2").value).toBe(11);
    expect(dropdowns?.getCell("A3").value).toBe(12);
    expect(dropdowns?.getCell("B4").value).toBe("Other");
    expect(dropdowns?.getCell("G6").value).toBe("NDA");
  });
});
