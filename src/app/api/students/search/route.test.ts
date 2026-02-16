import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getAccessibleSchoolCodes: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import { getAccessibleSchoolCodes } from "@/lib/permissions";
import { query } from "@/lib/db";
import { GET } from "./route";
import { NO_SESSION, ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetCodes = vi.mocked(getAccessibleSchoolCodes);
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/students/search", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = new Request("http://localhost/api/students/search?q=test");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
  });

  it("returns empty array when query is too short", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = new Request("http://localhost/api/students/search?q=a");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
    expect(mockGetCodes).not.toHaveBeenCalled();
  });

  it("returns empty array when user has no school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue([]);
    const req = new Request("http://localhost/api/students/search?q=john");
    const res = await GET(req as never);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it("searches all schools when user has all-school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue("all" as never);
    const results = [{ user_id: "1", first_name: "John", last_name: "Doe" }];
    mockQuery.mockResolvedValue(results);

    const req = new Request("http://localhost/api/students/search?q=john");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(results);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("af_school_category = 'JNV'"),
      ["%john%"],
    );
  });

  it("searches specific schools when user has limited access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue(["70705", "70706"] as never);
    mockQuery.mockResolvedValue([]);

    const req = new Request("http://localhost/api/students/search?q=test");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("sch.code = ANY($1)"),
      [["70705", "70706"], "%test%"],
    );
  });
});
