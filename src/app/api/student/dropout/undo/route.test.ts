import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/student-addition-access", () => ({ requireStudentDropoutUndoAccess: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { requireStudentDropoutUndoAccess } from "@/lib/student-addition-access";
import { jsonRequest, ADMIN_SESSION } from "../../../__test-utils__/api-test-helpers";
import { POST } from "./route";

const mockFetch = vi.fn();

describe("POST /api/student/dropout/undo", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mockFetch);
    process.env.DB_SERVICE_URL = "https://db.example.test/api";
    process.env.DB_SERVICE_TOKEN = "token";
    vi.mocked(getServerSession).mockResolvedValue(ADMIN_SESSION);
    vi.mocked(requireStudentDropoutUndoAccess).mockResolvedValue({
      ok: true,
      permission: {} as never,
      programId: 64,
      actor: { user_id: 1, email: "pm@example.org", login_type: "google", role: "program_manager" },
      school: { code: "JNV001", udise_code: "123" },
    });
    vi.mocked(query).mockResolvedValue([{ student_id: "S123", pen_number: "12345678901" }]);
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("authorizes and proxies the exact NVS undo", async () => {
    const response = await POST(jsonRequest("http://localhost/api/student/dropout/undo", {
      method: "POST",
      body: { student_pk_id: 100 },
    }) as never);

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://db.example.test/api/lms/students/undo-program-dropout",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          student_id: "S123",
          actor: { user_id: 1, email: "pm@example.org", login_type: "google", role: "program_manager" },
          school: { code: "JNV001", udise_code: "123" },
          program_id: 64,
        }),
      }),
    );
  });

  it("surfaces only safe undo errors", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ errors: "Student already has an active NVS batch" }), { status: 400 }));
    const request = () => jsonRequest("http://localhost/api/student/dropout/undo", {
      method: "POST",
      body: { student_pk_id: 100 },
    }) as never;

    expect(await (await POST(request())).json()).toEqual({ error: "Student already has an active NVS batch" });

    mockFetch.mockResolvedValue(new Response(JSON.stringify({ errors: "internal details" }), { status: 400 }));
    expect(await (await POST(request())).json()).toEqual({ error: "Failed to undo dropout" });
  });
});
