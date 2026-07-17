import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION,
  NO_SESSION,
  PASSCODE_SESSION,
} from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth");
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db");
vi.mock("@/lib/db-service-documents");
vi.mock("@/lib/permissions", () => ({
  getUserPermission: vi.fn(),
  canAccessSchoolSync: vi.fn(() => true),
  getFeatureAccess: vi.fn(() => ({ access: "edit", canView: true, canEdit: true })),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { listDocuments } from "@/lib/db-service-documents";
import { canAccessSchoolSync, getFeatureAccess } from "@/lib/permissions";

import { GET } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockListDocs = vi.mocked(listDocuments);
const mockCanAccess = vi.mocked(canAccessSchoolSync);
const mockFeature = vi.mocked(getFeatureAccess);

function req(grade?: string): NextRequest {
  const url = new URL("http://localhost/api/schools/SCH1/consent-status");
  if (grade) url.searchParams.set("grade", grade);
  return new NextRequest(url);
}

const params = { params: Promise.resolve({ code: "SCH1" }) };

const SCHOOL_ROW = [{ id: "10", code: "SCH1", region: "north" }];

function doc(type: string, deleted = false) {
  return {
    id: 1,
    student_id: 1,
    document_type: type,
    pages: [],
    metadata: {},
    uploaded_by: "x",
    deleted_at: deleted ? "2026-01-01" : null,
    inserted_at: "t",
    updated_at: "t",
  };
}

describe("GET /api/schools/[code]/consent-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanAccess.mockReturnValue(true);
    mockFeature.mockReturnValue({ access: "edit", canView: true, canEdit: true });
  });

  it("401 when no session", async () => {
    mockSession.mockResolvedValueOnce(NO_SESSION);
    const res = await GET(req(), params);
    expect(res.status).toBe(401);
  });

  it("400 for an invalid grade", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    const res = await GET(req("0"), params);
    expect(res.status).toBe(400);
  });

  it("404 when the school is not found", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce([] as never); // school lookup
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  it("403 when a passcode user targets another school", async () => {
    mockSession.mockResolvedValueOnce({
      ...PASSCODE_SESSION,
      schoolCode: "OTHER",
    });
    mockQuery.mockResolvedValueOnce(SCHOOL_ROW as never);
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
  });

  it("403 when a Google user lacks school access", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery.mockResolvedValueOnce(SCHOOL_ROW as never);
    mockCanAccess.mockReturnValue(false);
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
  });

  it("maps each student's required consent docs, ignoring deleted + non-required", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce(SCHOOL_ROW as never) // school lookup
      .mockResolvedValueOnce([
        { student_pk_id: "1" },
        { student_pk_id: "2" },
      ] as never); // grade-11 students

    mockListDocs.mockImplementation(async (id: number) => {
      if (id === 1) {
        return [
          doc("parent_undertaking"),
          doc("wise_research_consent"),
          doc("income_certificate"), // not a consent doc → ignored
        ] as never;
      }
      return [
        doc("parent_undertaking"),
        doc("wise_research_consent", true), // soft-deleted → ignored
      ] as never;
    });

    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.consent["1"].sort()).toEqual([
      "parent_undertaking",
      "wise_research_consent",
    ]);
    expect(body.consent["2"]).toEqual(["parent_undertaking"]);
    // With no ?grade, it defaults to both admission grades.
    expect(mockQuery.mock.calls[1][1]?.[2]).toEqual([11, 12]);
  });

  it("scopes to a single grade when ?grade is given", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce(SCHOOL_ROW as never)
      .mockResolvedValueOnce([] as never);
    await GET(req("12"), params);
    expect(mockQuery.mock.calls[1][1]?.[2]).toEqual([12]);
  });

  it("degrades a failed document lookup to empty consent", async () => {
    mockSession.mockResolvedValueOnce(ADMIN_SESSION);
    mockQuery
      .mockResolvedValueOnce(SCHOOL_ROW as never)
      .mockResolvedValueOnce([{ student_pk_id: "1" }] as never);
    mockListDocs.mockRejectedValueOnce(new Error("db-service down"));

    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.consent["1"]).toEqual([]);
  });
});
