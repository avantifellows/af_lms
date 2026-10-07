import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/bigquery", () => ({
  getAvailableGrades: vi.fn().mockResolvedValue([11, 12]),
  getAvailablePrograms: vi.fn().mockResolvedValue(["JNV CoE", "JNV NVS"]),
}));
vi.mock("@/lib/dynamodb", () => ({ getTestDeepDiveFromDynamo: vi.fn() }));
vi.mock("@/lib/curriculum-schema", () => ({
  checkCurriculumSchema: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/curriculum-options", () => ({
  getCurriculumOptions: vi.fn(),
  getCurriculumChapters: vi.fn(),
}));
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getResolvedPermission: vi.fn(),
  getAccessibleSchoolCodes: vi.fn(),
  getUserPermission: vi.fn(),
  canAccessSchool: vi.fn().mockResolvedValue(true),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { getCurriculumOptions } from "@/lib/curriculum-options";
import { getTestDeepDiveFromDynamo } from "@/lib/dynamodb";
import {
  getAccessibleSchoolCodes,
  getResolvedPermission,
  getUserPermission,
} from "@/lib/permissions";
import { GET, POST } from "./route";
import { issueTokens } from "@/lib/mcp/oauth";
import { PM_SESSION } from "../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockPermission = vi.mocked(getResolvedPermission);
const mockSchoolCodes = vi.mocked(getAccessibleSchoolCodes);
const mockQuery = vi.mocked(query);
const mockOptions = vi.mocked(getCurriculumOptions);

const PM_PERMISSION = {
  email: PM_SESSION.user.email,
  level: 2,
  role: "program_manager",
  read_only: false,
  program_ids: [1],
  scope: { schools: new Set(["S1", "S2"]), centres: new Set([7]) },
} as never;

function rpc(method: string, params?: unknown) {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function callTool(name: string, args: object = {}) {
  const res = await POST(rpc("tools/call", { name, arguments: args }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.result as { content: { text: string }[]; isError?: boolean };
}

describe("/api/mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("GET is 405: stateless, no event stream", async () => {
    expect((await GET()).status).toBe(405);
  });

  it("lists the tools", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    const body = await (await POST(rpc("tools/list"))).json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "whoami",
      "list_my_schools",
      "list_views",
      "get_view",
    ]);
  });

  describe("authentication", () => {
    it("is 401 with resource metadata when there is no caller", async () => {
      mockSession.mockResolvedValue(null);
      const res = await POST(rpc("tools/list"));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(
        'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"',
      );
      expect(mockPermission).not.toHaveBeenCalled();
    });

    it("passcode sessions are not callers", async () => {
      mockSession.mockResolvedValue({ ...PM_SESSION, isPasscodeUser: true });
      expect((await POST(rpc("tools/list"))).status).toBe(401);
    });

    it("accepts an OAuth bearer token without any cookie session", async () => {
      mockSession.mockResolvedValue(null);
      mockPermission.mockResolvedValue(PM_PERMISSION);
      const { access_token } = issueTokens(PM_SESSION.user.email, "client", "http://localhost");
      const req = rpc("tools/call", { name: "whoami", arguments: {} });
      req.headers.set("authorization", `Bearer ${access_token}`);
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockPermission).toHaveBeenCalledWith(PM_SESSION.user.email);
    });

    it("rejects a forged bearer token", async () => {
      mockSession.mockResolvedValue(null);
      const req = rpc("tools/list");
      req.headers.set("authorization", "Bearer eyJlbWFpbCI6ImFkbWluIn0.AAAA");
      expect((await POST(req)).status).toBe(401);
    });
  });

  it("whoami resolves the caller's LMS permission", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockPermission.mockResolvedValue(PM_PERMISSION);
    const summary = JSON.parse((await callTool("whoami")).content[0].text);
    expect(mockPermission).toHaveBeenCalledWith(PM_SESSION.user.email);
    expect(summary).toMatchObject({ role: "program_manager", schools: 2, centres: 1, read_only: false });
  });

  it("list_my_schools restricts the query to the caller's schools", async () => {
    mockSession.mockResolvedValue(PM_SESSION);
    mockSchoolCodes.mockResolvedValue(["S1", "S2"]);
    mockQuery.mockResolvedValue([{ code: "S1", udise_code: "U1", name: "JNV One", region: "R" }]);
    const result = await callTool("list_my_schools", { search: "One" });
    expect(mockSchoolCodes).toHaveBeenCalledWith(PM_SESSION.user.email);
    expect(mockQuery.mock.calls[0][1]).toEqual([["S1", "S2"], "%One%", 101]);
    expect(JSON.parse(result.content[0].text).schools).toHaveLength(1);
  });

  describe("get_view", () => {
    it("refuses a path outside the allow-list without invoking anything", async () => {
      mockSession.mockResolvedValue(PM_SESSION);
      const result = await callTool("get_view", { path: "/api/admin/users" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Unknown view/);
      expect(mockPermission).not.toHaveBeenCalled();
    });

    it("runs the real handler as the caller, not the outer request", async () => {
      // The outer request is the caller; inside the handler there is no
      // cookie session at all. The handler's gate must still see the caller.
      mockSession.mockResolvedValueOnce(PM_SESSION).mockResolvedValue(null);
      mockPermission.mockResolvedValue(PM_PERMISSION);
      mockOptions.mockResolvedValue({ ok: true, programs: [{ id: 1, name: "JNV CoE" }] } as never);

      const result = await callTool("get_view", {
        path: "/api/curriculum/options",
        query: { school_code: "S1" },
      });

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text).programs).toEqual([{ id: 1, name: "JNV CoE" }]);
      expect(mockSession).toHaveBeenCalledTimes(1);
      expect(mockPermission).toHaveBeenCalledWith(PM_SESSION.user.email);
      expect(mockOptions).toHaveBeenCalledWith(
        expect.objectContaining({ schoolCode: "S1", permission: PM_PERMISSION }),
      );
    });

    it("returns the handler's refusal as an error", async () => {
      mockSession.mockResolvedValue(PM_SESSION);
      mockPermission.mockResolvedValue(null);
      const result = await callTool("get_view", {
        path: "/api/curriculum/options",
        query: { school_code: "S1" },
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^HTTP 403/);
      expect(mockOptions).not.toHaveBeenCalled();
    });
  });

  describe("program-scoped quiz views", () => {
    const deepDive = (program?: string) =>
      callTool("get_view", {
        path: "/api/quiz-analytics/U1/test-deep-dive",
        query: { grade: 11, sessionId: "s1", ...(program ? { program } : {}) },
      });

    beforeEach(() => {
      mockSession.mockResolvedValue(PM_SESSION);
      mockPermission.mockResolvedValue(PM_PERMISSION);
      // A CoE-only (program 1) non-admin at a school offering CoE and NVS.
      vi.mocked(getUserPermission).mockResolvedValue({ ...(PM_PERMISSION as object), program_ids: [1] } as never);
      mockQuery.mockResolvedValue([{ id: "1", code: "S1", name: "JNV One", region: "R" }]);
    });

    it("requires a program, listing only the caller's", async () => {
      const result = await deepDive();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/must be one of: JNV CoE\.$/);
      expect(getTestDeepDiveFromDynamo).not.toHaveBeenCalled();
    });

    it("refuses a program the caller doesn't hold", async () => {
      const result = await deepDive("JNV NVS");
      expect(result.isError).toBe(true);
      expect(getTestDeepDiveFromDynamo).not.toHaveBeenCalled();
    });

    it("runs the view for an allowed program", async () => {
      vi.mocked(getTestDeepDiveFromDynamo).mockResolvedValue({ summary: {} } as never);
      const result = await deepDive("JNV CoE");
      expect(result.isError).toBeUndefined();
      expect(getTestDeepDiveFromDynamo).toHaveBeenCalledWith("1", "JNV One", 11, "s1", "JNV CoE", undefined);
    });
  });
});
