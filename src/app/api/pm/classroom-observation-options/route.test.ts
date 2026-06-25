import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
  PM_SESSION,
} from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth");
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db");
vi.mock("@/lib/classroom-observation-curriculum", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/classroom-observation-curriculum")>();
  return {
    ...actual,
    getClassroomObservationCurriculumOptions: vi.fn(),
  };
});

import { getServerSession } from "next-auth";

import { getClassroomObservationCurriculumOptions } from "@/lib/classroom-observation-curriculum";
import { query } from "@/lib/db";
import { GET } from "./route";

const mockGetServerSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockGetOptions = vi.mocked(getClassroomObservationCurriculumOptions);

function optionsRequest(params = "school_code=SCH001&grade=11"): NextRequest {
  return new NextRequest(new URL(`http://localhost/api/pm/classroom-observation-options?${params}`));
}

function stubPermission(overrides: Record<string, unknown> = {}) {
  mockQuery.mockResolvedValueOnce([
    {
      role: "program_manager",
      level: 3,
      school_codes: [],
      regions: [],
      program_ids: [1],
      read_only: false,
      ...overrides,
    },
  ] as never);
}

describe("GET /api/pm/classroom-observation-options", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(NO_SESSION);

    const response = await GET(optionsRequest());

    expect(response.status).toBe(401);
  });

  it("returns 403 for passcode users", async () => {
    mockGetServerSession.mockResolvedValueOnce(PASSCODE_SESSION);

    const response = await GET(optionsRequest());

    expect(response.status).toBe(403);
  });

  it("returns 400 when school_code is missing", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();

    const response = await GET(optionsRequest("grade=11"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "school_code query parameter is required",
    });
  });

  it("returns 400 when grade is invalid", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission();

    const response = await GET(optionsRequest("school_code=SCH001&grade=9"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "grade must be one of: 10, 11, 12",
    });
  });

  it("returns 403 when PM cannot access the requested school", async () => {
    mockGetServerSession.mockResolvedValueOnce(PM_SESSION);
    stubPermission({ level: 1, school_codes: ["OTHER"] });
    mockQuery.mockResolvedValueOnce([{ region: "North" }] as never);

    const response = await GET(optionsRequest());

    expect(response.status).toBe(403);
  });

  it("returns classroom observation curriculum options for an accessible school", async () => {
    mockGetServerSession.mockResolvedValueOnce(ADMIN_SESSION);
    stubPermission({ role: "admin" });
    mockQuery.mockResolvedValueOnce([{ region: "North" }] as never);
    mockGetOptions.mockResolvedValueOnce({
      curricula: [{ id: 1, name: "JEE Mains", code: "JMNS" }],
      chapters: [],
      topics: [],
    });

    const response = await GET(optionsRequest("school_code=SCH001&grade=12"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      curricula: [{ id: 1, name: "JEE Mains", code: "JMNS" }],
      chapters: [],
      topics: [],
    });
    expect(mockGetOptions).toHaveBeenCalledWith({ grade: 12 });
  });
});
