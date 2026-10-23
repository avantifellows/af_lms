import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alumni/access", () => ({ authorizeAlumni: vi.fn() }));
vi.mock("@/lib/alumni/students", () => ({ listPendingForSchool: vi.fn(), listAlumniForSchool: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { authorizeAlumni } from "@/lib/alumni/access";
import { listAlumniForSchool, listPendingForSchool } from "@/lib/alumni/students";
import { query } from "@/lib/db";
import { GET } from "./route";

const call = (code = "59525") => GET(new Request("http://localhost"), { params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "a@x", permission: {} as never });
  vi.mocked(query).mockResolvedValue([{ id: "7", code: "59525" }]);
  vi.mocked(listPendingForSchool).mockResolvedValue([]);
  vi.mocked(listAlumniForSchool).mockResolvedValue([]);
});

describe("GET /api/alumni/school/[code]", () => {
  it("checks access for that school before reading anything", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: false, response: Response.json({}, { status: 403 }) as never });
    expect((await call()).status).toBe(403);
    expect(vi.mocked(authorizeAlumni)).toHaveBeenCalledWith({ schoolCode: "59525" });
    expect(query).not.toHaveBeenCalled();
  });

  it("404 for an unknown school", async () => {
    vi.mocked(query).mockResolvedValue([]);
    expect((await call("nope")).status).toBe(404);
  });

  it("returns both lists for the school", async () => {
    vi.mocked(listPendingForSchool).mockResolvedValue([{ userId: "1" } as never]);
    vi.mocked(listAlumniForSchool).mockResolvedValue([{ userId: "2" } as never]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: [{ userId: "1" }], alumni: [{ userId: "2" }] });
    expect(listPendingForSchool).toHaveBeenCalledWith({ id: "7", code: "59525" });
  });
});
