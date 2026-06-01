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
vi.mock("@/lib/permissions", () => ({ getUserPermission: mockGetUserPermission }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/curriculum-schema", () => ({
  checkCurriculumConfigManagementSchema: mockCheckCurriculumConfigManagementSchema,
}));

import { GET } from "./route";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
} from "../../__test-utils__/api-test-helpers";

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

describe("GET /api/curriculum/configs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue(adminPermission);
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({ ok: true });
  });

  it("returns 401 for unauthenticated users", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await GET(nextReq("/api/curriculum/configs"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for passcode and non-admin Google users", async () => {
    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);
    expect((await GET(nextReq("/api/curriculum/configs"))).status).toBe(403);

    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    mockGetUserPermission.mockResolvedValueOnce({
      ...adminPermission,
      role: "program_manager",
    });
    expect((await GET(nextReq("/api/curriculum/configs"))).status).toBe(403);
  });

  it("returns controlled 503 when config-management schema is unavailable", async () => {
    mockCheckCurriculumConfigManagementSchema.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });

    const res = await GET(nextReq("/api/curriculum/configs"));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_chapter_exam_configs.id"],
    });
  });

  it("returns admin list results with normalized filters and pagination", async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          grades: [11, 12],
          subjects: [{ id: 4, name: [{ lang_code: "en", subject: "Physics" }] }],
          exam_tracks: ["jee_main", "neet"],
        },
      ])
      .mockResolvedValueOnce([{ total_count: "1" }])
      .mockResolvedValueOnce([
        {
          config_id: "42",
          chapter_id: "7",
          chapter_code: "PHY-01",
          chapter_name: [{ lang_code: "en", chapter: "Motion" }],
          grade: "11",
          subject_id: "4",
          subject_name: [{ lang_code: "en", subject: "Physics" }],
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
        "/api/curriculum/configs?exam_track=bad&grade=abc&subject=&search=Motion&syllabus_status=all&page=2&limit=10&sort=unknown&dir=desc&school=LMS75&program=2"
      )
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      filters: {
        examTrack: "jee_main",
        grade: null,
        subject: null,
        search: "Motion",
        syllabusStatus: "all",
      },
      pagination: {
        page: 1,
        limit: 10,
        totalRows: 1,
        totalPages: 1,
      },
      sort: { sort: "curriculum", dir: "desc" },
      filterOptions: {
        grades: [11, 12],
        subjects: [{ id: 4, name: "Physics" }],
        examTracks: ["jee_main", "neet"],
      },
      rows: [{ id: 42, updatedByEmail: "", updatedAt: "" }],
    });
    expect(json.filters).not.toHaveProperty("school");
    expect(json.filters).not.toHaveProperty("program");
  });
});
