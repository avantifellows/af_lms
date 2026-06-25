import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockRequireStaffAdmin, mockUpdateTeacherRecord } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockRequireStaffAdmin: vi.fn(),
    mockUpdateTeacherRecord: vi.fn(),
  }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/staff-admin", () => ({
  requireStaffAdmin: mockRequireStaffAdmin,
  updateTeacherRecord: mockUpdateTeacherRecord,
  safeStaffApiError: (result: { error: string; fields?: Record<string, string> }) =>
    result.fields ? { error: result.error, fields: result.fields } : { error: result.error },
}));

import { PATCH } from "./route";
import {
  jsonRequest,
  routeParams,
} from "../../../../__test-utils__/api-test-helpers";

describe("PATCH /api/admin/staff/teachers/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireStaffAdmin.mockResolvedValue({
      ok: true,
      email: "admin@avantifellows.org",
    });
  });

  it("propagates guard failures", async () => {
    mockRequireStaffAdmin.mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: "Forbidden",
    });
    const response = await PATCH(
      jsonRequest("http://localhost/api/admin/staff/teachers/1", {
        method: "PATCH",
        body: { teacher_id: "AF1" },
      }) as never,
      routeParams({ id: "1" })
    );
    expect(response.status).toBe(403);
  });

  it("rejects bad ids and bad JSON", async () => {
    const response = await PATCH(
      jsonRequest("http://localhost/api/admin/staff/teachers/abc", {
        method: "PATCH",
        body: {},
      }) as never,
      routeParams({ id: "abc" })
    );
    expect(response.status).toBe(400);

    const badJson = new Request("http://localhost/api/admin/staff/teachers/1", {
      method: "PATCH",
      body: "{nope",
      headers: { "Content-Type": "application/json" },
    });
    expect((await PATCH(badJson as never, routeParams({ id: "1" }))).status).toBe(400);
  });

  it("maps lib results to responses", async () => {
    mockUpdateTeacherRecord.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "taken",
    });
    const conflict = await PATCH(
      jsonRequest("http://localhost/api/admin/staff/teachers/1", {
        method: "PATCH",
        body: { teacher_id: "AF1" },
      }) as never,
      routeParams({ id: "1" })
    );
    expect(conflict.status).toBe(409);

    mockUpdateTeacherRecord.mockResolvedValueOnce({ ok: true });
    const success = await PATCH(
      jsonRequest("http://localhost/api/admin/staff/teachers/1", {
        method: "PATCH",
        body: { teacher_id: "AF1" },
      }) as never,
      routeParams({ id: "1" })
    );
    expect(success.status).toBe(200);
    expect(mockUpdateTeacherRecord).toHaveBeenCalledWith({
      id: 1,
      body: { teacher_id: "AF1" },
    });
  });
});
