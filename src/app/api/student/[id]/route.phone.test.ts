import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockQuery,
  mockRequireStudentEditAccess,
  mockRequireStudentAdditionStudentAccess,
  mockDeriveLmsEnrollmentPeriod,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockQuery: vi.fn(),
  mockRequireStudentEditAccess: vi.fn(),
  mockRequireStudentAdditionStudentAccess: vi.fn(),
  mockDeriveLmsEnrollmentPeriod: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/student-addition-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/student-addition-access")>(
    "@/lib/student-addition-access",
  );
  return {
    ...actual,
    requireStudentEditAccess: mockRequireStudentEditAccess,
    requireStudentAdditionStudentAccess: mockRequireStudentAdditionStudentAccess,
  };
});
vi.mock("@/lib/lms-enrollment-date", () => ({
  deriveLmsEnrollmentPeriod: mockDeriveLmsEnrollmentPeriod,
}));
import { getServerSession } from "next-auth";
import { PATCH } from "./route";
import {
  requireStudentAdditionStudentAccess,
  requireStudentEditAccess,
} from "@/lib/student-addition-access";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { ADMIN_SESSION, jsonRequest, routeParams } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockRequireStudentEdit = vi.mocked(requireStudentEditAccess);
const mockRequireStudentAdditionStudent = vi.mocked(requireStudentAdditionStudentAccess);
const mockPeriod = vi.mocked(deriveLmsEnrollmentPeriod);
const mockFetch = vi.fn();

const allPhoneCohortFacts = {
  has_jnv_nvs_membership: true,
  has_enable_students_membership: true,
  student_id_matches_phone: true,
};

const genericEditAccess = {
  ok: true as const,
  programId: 64,
  permission: {} as never,
  actor: {
    user_id: 501,
    email: "pm@example.org",
    login_type: "google" as const,
    role: "program_manager" as const,
  },
  school: { code: "JNV001", udise_code: "12345678901" },
};

const strictPhoneCorrectionAccess = {
  ...genericEditAccess,
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.DB_SERVICE_URL = "https://db.example.test/api";
  process.env.DB_SERVICE_TOKEN = "test-token";
  vi.stubGlobal("fetch", mockFetch);
  mockSession.mockResolvedValue(ADMIN_SESSION);
  mockQuery.mockResolvedValue([allPhoneCohortFacts]);
  mockRequireStudentEdit.mockResolvedValue(genericEditAccess);
  mockRequireStudentAdditionStudent.mockResolvedValue(strictPhoneCorrectionAccess);
  mockPeriod.mockReturnValue({
    start_date: "2026-07-01",
    academic_year: "2026-2027",
  });
  mockFetch.mockResolvedValue(
    new Response(JSON.stringify({ status: "updated" }), { status: 200 }),
  );
});

const params = routeParams({ id: "100" });

describe("PATCH /api/student/[id] in Phone Registration Mode", () => {
  it.each([
    ["JNV NVS membership", { has_jnv_nvs_membership: false }],
    ["EnableStudents membership", { has_enable_students_membership: false }],
    ["phone Student ID equality", { student_id_matches_phone: false }],
  ])("does not infer a Phone Registration Mode Student when %s is missing", async (_label, missing) => {
    mockQuery.mockResolvedValueOnce([{ ...allPhoneCohortFacts, ...missing }]);

    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 64, phone: "5876543210" },
      }) as never,
      params,
    );

    expect(response.status).toBe(200);
    expect(mockRequireStudentAdditionStudent).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a non-NVS Student Edit on its existing path while Phone mode is active", async () => {
    mockRequireStudentEdit.mockResolvedValueOnce({
      ...genericEditAccess,
      programId: 1,
    });
    mockQuery.mockResolvedValueOnce([{
      has_jnv_nvs_membership: false,
      has_enable_students_membership: false,
      student_id_matches_phone: false,
    }]);

    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 1, first_name: "Updated Student" },
      }) as never,
      params,
    );

    expect(response.status).toBe(200);
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({
      program_id: 1,
      first_name: "Updated Student",
      registration_mode: "phone",
      registration_mode_version: "1",
    });
  });

  it("uses the stricter NVS actor gate and sends the atomic correction contract", async () => {
    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 64, phone: "6876543210" },
      }) as never,
      params,
    );

    expect(response.status).toBe(200);
    expect(mockRequireStudentAdditionStudent).toHaveBeenCalledWith(ADMIN_SESSION, "100");

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(payload).toMatchObject({
      actor: strictPhoneCorrectionAccess.actor,
      school: strictPhoneCorrectionAccess.school,
      program_id: 64,
      phone: "6876543210",
      registration_mode: "phone",
      registration_mode_version: "1",
      start_date: "2026-07-01",
      academic_year: "2026-2027",
    });
  });

  it("rejects a correction phone outside the Phone Registration rule", async () => {
    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 64, phone: "5876543210" },
      }) as never,
      params,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Parents Phone Number must be exactly 10 digits and start with 6-9",
      field_errors: {
        phone: "Parents Phone Number must be exactly 10 digits and start with 6-9",
      },
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("denies a phone correction when the stricter NVS actor gate denies it", async () => {
    mockRequireStudentAdditionStudent.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 64, phone: "6876543210" },
      }) as never,
      params,
    );

    expect(response.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects restricted fields for an inferred Phone Registration Mode Student", async () => {
    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: {
          program_id: 64,
          annual_family_income: "Less than Rs. 1,00,000",
          pen_number: "01234567890",
          g10_roll_no: "12345678",
        },
      }) as never,
      params,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Restricted fields are not accepted for Phone Registration Mode Students",
      field_errors: {
        annual_family_income: "Annual Family Income is not accepted in Phone Registration Mode",
        pen_number: "PEN Number is not accepted in Phone Registration Mode",
        g10_roll_no: "Grade 10 Roll no is not accepted in Phone Registration Mode",
      },
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails closed when DB Service reports a Registration Mode mismatch", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "registration_mode_mismatch",
            message: "LMS and DB Service registration modes differ",
          },
        }),
        { status: 409 },
      ),
    );

    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 64, phone: "6876543210" },
      }) as never,
      params,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        "Student registration is temporarily unavailable while Registration Mode is being coordinated. Please try again shortly.",
    });
  });

  it.each([
    ["same-school", "JNV001", "This phone number is already linked to a Student in this school."],
    [
      "other-school",
      "JNV002",
      "This phone number is already linked to a Student in another school and cannot be transferred.",
    ],
  ])("renders the %s duplicate matrix result", async (_label, existingSchoolCode, message) => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "phone_student_id_conflict",
            message: "Phone Student ID is already in use",
            fields: ["phone"],
            existing_match: {
              student_id: "6876543210",
              school_code: existingSchoolCode,
              school_name: "Existing JNV",
            },
          },
        }),
        { status: 409 },
      ),
    );

    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 64, phone: "6876543210" },
      }) as never,
      params,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: message,
      code: "phone_student_id_conflict",
      field_errors: { phone: message },
      existing_match: {
        student_id: "6876543210",
        school_code: existingSchoolCode,
        school_name: "Existing JNV",
      },
    });
  });

  it("allows the same phone Student ID in another auth group", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "updated" }), { status: 200 }),
    );

    const response = await PATCH(
      jsonRequest("http://localhost/api/student/100", {
        method: "PATCH",
        body: { program_id: 64, phone: "6876543210" },
      }) as never,
      params,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "updated" });
  });
});
