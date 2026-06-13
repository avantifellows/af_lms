import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/permissions", () => {
  const getUserPermission = vi.fn();
  return {
    PROGRAM_IDS: { COE: 1, NODAL: 2, NVS: 64 },
    getFeatureAccess: vi.fn(),
    getUserPermission,
    getResolvedPermission: getUserPermission,
    canAccessSchoolSync: vi.fn(),
  };
});

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import { GET } from "./route";
import {
  ADMIN_SESSION,
  PASSCODE_SESSION,
  TEACHER_SESSION,
} from "../../__test-utils__/api-test-helpers";
import { resetCurriculumSchemaCheckForTests } from "@/lib/curriculum-schema";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

function nextReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost"));
}

describe("GET /api/curriculum/options", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCurriculumSchemaCheckForTests();
    mockSession.mockResolvedValue(TEACHER_SESSION);
    mockGetUserPermission.mockResolvedValue({
      email: "teacher@avantifellows.org",
      level: 1,
      role: "teacher",
      school_codes: ["70705"],
      regions: null,
      program_ids: [1],
      read_only: false,
    });
    mockGetFeatureAccess.mockReturnValue({
      access: "edit",
      canView: true,
      canEdit: true,
    });
    mockCanAccessSchoolSync.mockReturnValue(true);
  });

  it("returns allowed programs, configured tracks, grade subjects, and defaults", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1, 2, 64] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          exam_track: "jee_main",
          grade_id: 3,
          grade: 11,
          subject_id: 4,
          subject: [{ lang_code: "en", subject: "Physics" }],
        },
        {
          exam_track: "neet",
          grade_id: 4,
          grade: 12,
          subject_id: 3,
          subject: [{ lang_code: "en", subject: "Biology" }],
        },
      ]);

    const res = await GET(nextReq("/api/curriculum/options?school_code=70705"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      programs: [{ id: 1, name: "JNV CoE" }],
      examTracks: ["jee_main", "neet"],
      gradeSubjects: [
        {
          examTrack: "jee_main",
          grade: 11,
          gradeId: 3,
          subject: "Physics",
          subjectId: 4,
        },
        {
          examTrack: "neet",
          grade: 12,
          gradeId: 4,
          subject: "Biology",
          subjectId: 3,
        },
      ],
      defaults: {
        programId: 1,
        examTrack: "jee_main",
        grade: 11,
        gradeId: 3,
        subject: "Physics",
        subjectId: 4,
      },
    });
  });

  it("uses program_id only to override the default Program without filtering the Program list", async () => {
    mockGetUserPermission.mockResolvedValue({
      email: "teacher@avantifellows.org",
      level: 1,
      role: "teacher",
      school_codes: ["70705"],
      regions: null,
      program_ids: [1, 2],
      read_only: false,
    });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1, 2, 64] },
      ])
      .mockResolvedValueOnce([
        { id: "1", name: "JNV CoE" },
        { id: "2", name: "JNV Nodal" },
      ])
      .mockResolvedValueOnce([]);

    const res = await GET(
      nextReq("/api/curriculum/options?school_code=70705&program_id=2")
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.programs).toEqual([
      { id: 1, name: "JNV CoE" },
      { id: 2, name: "JNV Nodal" },
    ]);
    expect(json.defaults.programId).toBe(2);
  });

  it("allows admins to see CoE/Nodal Programs while excluding NVS", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetUserPermission.mockResolvedValue({
      email: "admin@avantifellows.org",
      level: 3,
      role: "admin",
      school_codes: null,
      regions: null,
      program_ids: null,
      read_only: false,
    });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1, 2, 64] },
      ])
      .mockResolvedValueOnce([
        { id: 1, name: "JNV CoE" },
        { id: 2, name: "JNV Nodal" },
      ])
      .mockResolvedValueOnce([]);

    const res = await GET(nextReq("/api/curriculum/options?school_code=70705"));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.programs).toEqual([
      { id: 1, name: "JNV CoE" },
      { id: 2, name: "JNV Nodal" },
    ]);
  });

  it("returns an empty state when the user has no curriculum-backed Program", async () => {
    mockGetUserPermission.mockResolvedValue({
      email: "teacher@avantifellows.org",
      level: 1,
      role: "teacher",
      school_codes: ["70705"],
      regions: null,
      program_ids: [64],
      read_only: false,
    });
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD" },
      ]);

    const res = await GET(nextReq("/api/curriculum/options?school_code=70705"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      programs: [],
      examTracks: [],
      gradeSubjects: [],
      defaults: {
        programId: null,
        examTrack: null,
        grade: null,
        gradeId: null,
        subject: null,
        subjectId: null,
      },
    });
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await GET(nextReq("/api/curriculum/options?school_code=70705"));

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns controlled 503 when the LMS curriculum schema is missing", async () => {
    mockQuery.mockResolvedValueOnce([
      { table_name: "lms_curriculum_logs", column_name: "school_code" },
    ]);

    const res = await GET(nextReq("/api/curriculum/options?school_code=70705"));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "LMS curriculum schema unavailable",
      details: ["lms_curriculum_logs.school_code"],
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
