import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import JSZip from "jszip";

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
vi.mock("@/lib/registration-mode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/registration-mode")>("@/lib/registration-mode");
  return {
    ...actual,
    ACTIVE_REGISTRATION_MODE: actual.PHONE_REGISTRATION_MODE,
    getRegistrationModeHandshake: () => actual.getRegistrationModeHandshake(actual.PHONE_REGISTRATION_MODE),
  };
});

import { GET, POST } from "./route";
import { PROGRAM_IDS } from "@/lib/constants";
import { jsonRequest, routeParams, ADMIN_SESSION } from "../../../__test-utils__/api-test-helpers";

const school = {
  id: "school-1",
  code: "JNV001",
  udise_code: "12345678901",
  region: "South",
  af_school_category: "JNV",
};

const phoneModeBody = {
  grade: "12",
  student_name: " asha  k kumar ",
  date_of_birth: "02/01/2010",
  gender: "Female",
  category: "Gen",
  physically_handicapped: "No",
  g10_board: "Others",
  board_stream: "PCM",
  stream: "Engineering",
  father_name: "Ravi Kumar",
  phone: " 6876543210 ",
};

describe("POST /api/school/[udise]/students in Phone Registration Mode", () => {
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

  it("accepts a Grade 12 row and proxies the normalized phone as the Student ID", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 1, created: 1, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
          results: [{ row_number: 1, status: "created", generated_student_id: "6876543210" }],
        }),
        { status: 200 },
      ),
    );

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: phoneModeBody,
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload).toMatchObject({
      registration_mode: "phone",
      registration_mode_version: "1",
      academic_year: "2026-2027",
      start_date: "2026-07-01",
      rows: [{
        grade: 12,
        phone: "6876543210",
        student_id: "6876543210",
      }],
    });
    expect(payload.rows[0]).not.toHaveProperty("pen_number");
    expect(payload.rows[0]).not.toHaveProperty("g10_roll_no");
    expect(payload.rows[0]).not.toHaveProperty("annual_family_income");
  });

  it("also accepts Grade 11 in Phone mode", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ results: [{ row_number: 1, status: "created" }] }), { status: 200 }),
    );

    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: { ...phoneModeBody, grade: "11" },
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload.rows[0]).toMatchObject({ grade: 11, student_id: "6876543210" });
  });

  it("rejects crafted restricted fields before forwarding a Phone-mode request", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: {
          ...phoneModeBody,
          pen_number: "01234567890",
          g10_roll_no: "12345678",
          annual_family_income: "Less than Rs. 1,00,000",
        },
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      results: [{
        status: "rejected",
        field_errors: {
          pen_number: "PEN Number is not accepted in Phone Registration Mode",
          g10_roll_no: "Grade 10 Roll no is not accepted in Phone Registration Mode",
          annual_family_income: "Annual Family Income is not accepted in Phone Registration Mode",
        },
      }],
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a phone outside the Phone-mode 6-9 range before forwarding", async () => {
    const response = await POST(
      jsonRequest("http://localhost/api/school/12345678901/students", {
        method: "POST",
        body: { ...phoneModeBody, phone: "5876543210" },
      }) as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      results: [{ status: "rejected", field_errors: { phone: "Enter a valid phone number" } }],
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("GET /api/school/[udise]/students template in Phone Registration Mode", () => {
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

  it("serves the HQ workbook byte-for-byte with its raw x14 dropdown validations", async () => {
    const response = await GET(
      new Request("http://localhost/api/school/12345678901/students") as never,
      routeParams({ udise: "12345678901" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="NVS_Lakshya_Data_Template_updated_19th_August_2026.xlsx"',
    );

    const workbookBytes = Buffer.from(await response.arrayBuffer());
    expect(createHash("sha256").update(workbookBytes).digest("hex")).toBe(
      "657f236c35bda1d01375126394091a68ff7a4e3753c8036a030835762739c6e7",
    );

    const zip = await JSZip.loadAsync(workbookBytes);
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    const templateXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    expect(workbookXml).toContain('name="Template"');
    expect(workbookXml).toContain('name="Dropdown values"');
    expect(templateXml).toContain('<x14:dataValidations count="7"');
  });
});
