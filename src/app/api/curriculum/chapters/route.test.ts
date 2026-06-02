import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  PROGRAM_IDS: { COE: 1, NODAL: 2, NVS: 64 },
  getFeatureAccess: vi.fn(),
  getUserPermission: vi.fn(),
  canAccessSchoolSync: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import { GET } from "./route";
import { PASSCODE_SESSION, TEACHER_SESSION } from "../../__test-utils__/api-test-helpers";
import { resetCurriculumSchemaCheckForTests } from "@/lib/curriculum-schema";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockGetUserPermission = vi.mocked(getUserPermission);
const mockGetFeatureAccess = vi.mocked(getFeatureAccess);
const mockCanAccessSchoolSync = vi.mocked(canAccessSchoolSync);

function nextReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost"));
}

describe("GET /api/curriculum/chapters", () => {
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

  it("returns 400 when required scope params are missing", async () => {
    mockQuery.mockResolvedValueOnce([]);

    const res = await GET(nextReq("/api/curriculum/chapters?school_code=70705"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "school_code, program_id, exam_track, grade, and subject are required",
    });
  });

  it("returns in-syllabus chapters with topics, prescribed minutes, Exam Track, and configured ordering", async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { code: "70705", region: "AHMEDABAD", program_ids: [1, 2, 64] },
      ])
      .mockResolvedValueOnce([{ id: 1, name: "JNV CoE" }])
      .mockResolvedValueOnce([
        {
          chapter_id: 20,
          chapter_code: "BIO02",
          chapter_name: [{ lang_code: "en", chapter: "Human Physiology" }],
          grade_id: 4,
          grade: 12,
          subject_id: 3,
          subject_name: [{ lang_code: "en", subject: "Biology" }],
          exam_track: "neet",
          prescribed_minutes: 120,
          coverage_sequence: 1,
          topic_id: 201,
          topic_code: "BIO02.01",
          topic_name: [{ lang_code: "en", topic: "Digestion" }],
        },
        {
          chapter_id: 10,
          chapter_code: "BIO01",
          chapter_name: [{ lang_code: "en", chapter: "Plant Kingdom" }],
          grade_id: 4,
          grade: 12,
          subject_id: 3,
          subject_name: [{ lang_code: "en", subject: "Biology" }],
          exam_track: "neet",
          prescribed_minutes: 90,
          coverage_sequence: 1,
          topic_id: 101,
          topic_code: "BIO01.01",
          topic_name: [{ lang_code: "en", topic: "Algae" }],
        },
      ]);

    const res = await GET(
      nextReq(
        "/api/curriculum/chapters?school_code=70705&program_id=1&exam_track=neet&grade=12&subject=Biology"
      )
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.chapters).toEqual([
      expect.objectContaining({
        id: 10,
        code: "BIO01",
        name: "Plant Kingdom",
        examTrack: "neet",
        prescribedMinutes: 90,
        coverageSequence: 1,
        topics: [
          { id: 101, code: "BIO01.01", name: "Algae", chapterId: 10 },
        ],
      }),
      expect.objectContaining({
        id: 20,
        code: "BIO02",
        name: "Human Physiology",
        prescribedMinutes: 120,
      }),
    ]);
  });

  it("returns 403 for passcode users", async () => {
    mockSession.mockResolvedValue(PASSCODE_SESSION);

    const res = await GET(
      nextReq(
        "/api/curriculum/chapters?school_code=70705&program_id=1&exam_track=neet&grade=12&subject=Biology"
      )
    );

    expect(res.status).toBe(403);
  });
});
