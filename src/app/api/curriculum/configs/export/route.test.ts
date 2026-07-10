import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockQuery,
  mockCheckCurriculumConfigManagementSchema,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockQuery: vi.fn(),
  mockCheckCurriculumConfigManagementSchema: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
  PROGRAM_IDS: { COE: 1, NODAL: 2 },
  PHYSICAL_CENTRE_PROGRAM_IDS: [1, 2, 74, 94, 78, 88],
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/curriculum-schema", () => ({
  checkCurriculumConfigManagementSchema: mockCheckCurriculumConfigManagementSchema,
}));

import { GET } from "./route";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
} from "../../../__test-utils__/api-test-helpers";

function nextReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost"));
}

const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
};

describe("GET /api/curriculum/configs/export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
    vi.setSystemTime(new Date("2026-06-01T08:15:00.000Z"));
  });

  it("returns filtered admin CSV with attachment headers and no pagination", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        config_id: "42",
        chapter_id: "7",
        chapter_code: "PHY-01",
        chapter_name: "Motion",
        grade: "11",
        subject_id: "4",
        subject_name: "Physics",
        exam_track: "jee_main",
        is_in_syllabus: true,
        prescribed_minutes: "90",
        coverage_sequence: "2",
        updated_by_email: null,
        updated_at: null,
      },
    ]);

    const res = await GET(
      nextReq(
        "/api/curriculum/configs/export?exam_track=jee_main&grade=11&subject=4&search=motion&syllabus_status=all&page=3&limit=10&sort=coverage_sequence&dir=desc"
      )
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="curriculum-config-2026-06-01.csv"'
    );
    await expect(res.text()).resolves.toBe(
      [
        "chapter_code,chapter_name,grade,subject,exam_track,is_in_syllabus,prescribed_minutes,prescribed_hours,coverage_sequence,updated_by_email,updated_at",
        "PHY-01,Motion,11,Physics,jee_main,true,90,1.5,2,,",
      ].join("\r\n")
    );
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "jee_main",
      11,
      "4",
      "%motion%",
      "all",
      null, // chapter_id filter not set in this request
    ]);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("ORDER BY coverage_sequence DESC");
    expect(sql).not.toContain("LIMIT $6");
    expect(sql).not.toContain("OFFSET");
  });

  it("returns 401, 403, and 503 before exporting", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect((await GET(nextReq("/api/curriculum/configs/export"))).status).toBe(401);

    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect((await GET(nextReq("/api/curriculum/configs/export"))).status).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_manager",
    });
    expect((await GET(nextReq("/api/curriculum/configs/export"))).status).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_admin",
    });
    expect((await GET(nextReq("/api/curriculum/configs/export"))).status).toBe(403);

    mockCheckCurriculumConfigManagementSchema.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
    const unavailable = await GET(nextReq("/api/curriculum/configs/export"));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
  });
});
