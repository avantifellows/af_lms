import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION,
  NO_SESSION,
  PMU_MANAGER_SESSION,
} from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth");
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db");
vi.mock("@/lib/permissions", () => ({
  getResolvedPermission: vi.fn(),
  canAccessSchoolSync: vi.fn(() => true),
  getFeatureAccess: vi.fn(() => ({ access: "edit", canView: true, canEdit: true })),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getResolvedPermission,
} from "@/lib/permissions";

import { GET } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockCanAccess = vi.mocked(canAccessSchoolSync);
const mockFeature = vi.mocked(getFeatureAccess);
const mockGetPermission = vi.mocked(getResolvedPermission);

const params = { params: Promise.resolve({ code: "SCH1" }) };
const SCHOOL_ROW = [{ id: "10", code: "SCH1", region: "north" }];

const ADMIN_PERMISSION = {
  email: ADMIN_SESSION.user.email,
  level: 3,
  role: "admin",
  regions: null,
  school_codes: null,
  program_ids: null,
  read_only: false,
};

const PMU_PERMISSION = {
  email: PMU_MANAGER_SESSION.user.email,
  level: 3,
  role: "pmu_manager",
  regions: null,
  school_codes: null,
  program_ids: [64],
  read_only: false,
};

function request() {
  return new Request("http://localhost/api/schools/SCH1/document-status");
}

describe("GET /api/schools/[code]/document-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockCanAccess.mockReturnValue(true);
    mockFeature.mockReturnValue({ access: "edit", canView: true, canEdit: true });
    mockGetPermission.mockResolvedValue(ADMIN_PERMISSION as never);
  });

  it("401 without a session", async () => {
    mockSession.mockResolvedValueOnce(NO_SESSION);

    expect((await GET(request(), params)).status).toBe(401);
  });

  it("404 when the School is not one the viewer can open", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce([] as never);

    expect((await GET(request(), params)).status).toBe(404);
  });

  it("403 without School access", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce(SCHOOL_ROW as never);
    mockCanAccess.mockReturnValue(false);

    expect((await GET(request(), params)).status).toBe(403);
  });

  it("403 without students view", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce(SCHOOL_ROW as never);
    mockFeature.mockReturnValue({ access: "none", canView: false, canEdit: false });

    expect((await GET(request(), params)).status).toBe(403);
  });

  // Documents are a physical-centre feature (#433); a PMU role never has one
  // to read, and an empty map would be counted as every Student missing
  // everything.
  it("403 for a PMU role, documents being physical-centre only", async () => {
    mockSession.mockResolvedValueOnce(PMU_MANAGER_SESSION);
    mockQuery.mockResolvedValueOnce(SCHOOL_ROW as never);
    mockGetPermission.mockResolvedValue(PMU_PERMISSION as never);

    const res = await GET(request(), params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Documents are not collected for JNV NVS Students",
    });
  });

  it("returns the types on file per Student, and an empty list for the rest", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce(SCHOOL_ROW as never)
      .mockResolvedValueOnce([
        { student_pk_id: "1" },
        { student_pk_id: "2" },
      ] as never)
      .mockResolvedValueOnce([
        { student_id: "1", document_type: "parent_undertaking" },
        { student_id: "1", document_type: "student_photograph" },
      ] as never);

    const res = await GET(request(), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      documents: {
        "1": ["parent_undertaking", "student_photograph"],
        "2": [],
      },
    });
  });

  // The whole point of this route: the consent summary asks the DB Service
  // once per Student, which can't answer "who is missing what" across a
  // School's roster.
  it("reads the documents in one query for the School, not one per Student", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce(SCHOOL_ROW as never)
      .mockResolvedValueOnce(
        Array.from({ length: 40 }, (_, i) => ({ student_pk_id: String(i + 1) })) as never,
      )
      .mockResolvedValueOnce([] as never);

    await GET(request(), params);

    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [documentsSql, documentsParams] = mockQuery.mock.calls[2];
    expect(documentsSql).toContain("FROM lms_student_documents");
    expect(documentsSql).toContain("deleted_at IS NULL");
    expect(documentsParams?.[0]).toHaveLength(40);
  });

  it("skips the documents query for a School with no current Students", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce(SCHOOL_ROW as never)
      .mockResolvedValueOnce([] as never);

    const res = await GET(request(), params);

    expect(await res.json()).toEqual({ documents: {} });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("500s rather than reporting a read failure as empty documents", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce(SCHOOL_ROW as never)
      .mockResolvedValueOnce([{ student_pk_id: "1" }] as never)
      .mockRejectedValueOnce(new Error("connection reset"));

    expect((await GET(request(), params)).status).toBe(500);
  });
});
