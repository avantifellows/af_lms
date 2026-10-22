import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/alumni/access", () => ({ authorizeAlumni: vi.fn() }));
vi.mock("@/lib/alumni/students", () => ({ findAlumni: vi.fn(), MAX_FIND_LENGTH: 100 }));

import { authorizeAlumni } from "@/lib/alumni/access";
import { findAlumni } from "@/lib/alumni/students";
import { GET } from "./route";

const PERMISSION = { level: 3, role: "admin" };
const get = (q: string) => GET(new Request(`http://localhost/api/alumni/find?q=${encodeURIComponent(q)}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "a@x.org", permission: PERMISSION } as never);
  vi.mocked(findAlumni).mockResolvedValue([]);
});

describe("GET /api/alumni/find", () => {
  it("refuses callers without the alumni feature", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Access denied" }, { status: 403 }) });
    expect((await get("asha")).status).toBe(403);
    expect(findAlumni).not.toHaveBeenCalled();
  });

  it("searches within the caller's scope", async () => {
    vi.mocked(findAlumni).mockResolvedValue([{ alumniId: "1", afid: "", name: "Asha", cohortYear: "", schoolCode: "", schoolName: "" }]);
    const res = await get("asha");
    expect(res.status).toBe(200);
    expect((await res.json()).results).toHaveLength(1);
    expect(findAlumni).toHaveBeenCalledWith(PERMISSION, "asha");
  });

  it("caps the query length and reports a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findAlumni).mockRejectedValue(new Error("db down"));
    const res = await get("x".repeat(500));
    expect(res.status).toBe(500);
    expect(vi.mocked(findAlumni).mock.calls[0][1]).toHaveLength(100);
  });
});
