import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockRequireStaffAdmin, mockUpdateStaffName } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockRequireStaffAdmin: vi.fn(),
    mockUpdateStaffName: vi.fn(),
  }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/staff-admin", () => ({
  requireStaffAdmin: mockRequireStaffAdmin,
  updateStaffName: mockUpdateStaffName,
  safeStaffApiError: (result: { error: string; fields?: Record<string, string> }) =>
    result.fields ? { error: result.error, fields: result.fields } : { error: result.error },
}));

import { PATCH } from "./route";
import { jsonRequest } from "../../../__test-utils__/api-test-helpers";

describe("PATCH /api/admin/staff/name", () => {
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
      jsonRequest("http://localhost/api/admin/staff/name", {
        method: "PATCH",
        body: { user_id: 1, full_name: "Jane Doe" },
      }) as never
    );
    expect(response.status).toBe(403);
    expect(mockUpdateStaffName).not.toHaveBeenCalled();
  });

  it("rejects bad JSON", async () => {
    const badJson = new Request("http://localhost/api/admin/staff/name", {
      method: "PATCH",
      body: "{nope",
      headers: { "Content-Type": "application/json" },
    });
    expect((await PATCH(badJson as never)).status).toBe(400);
  });

  it("maps lib results to responses", async () => {
    mockUpdateStaffName.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: "Person not found",
    });
    const missing = await PATCH(
      jsonRequest("http://localhost/api/admin/staff/name", {
        method: "PATCH",
        body: { user_id: 999, full_name: "Ghost" },
      }) as never
    );
    expect(missing.status).toBe(404);

    mockUpdateStaffName.mockResolvedValueOnce({ ok: true });
    const success = await PATCH(
      jsonRequest("http://localhost/api/admin/staff/name", {
        method: "PATCH",
        body: { user_id: 70, full_name: "Jane Doe" },
      }) as never
    );
    expect(success.status).toBe(200);
    expect(mockUpdateStaffName).toHaveBeenCalledWith({
      body: { user_id: 70, full_name: "Jane Doe" },
    });
  });
});
