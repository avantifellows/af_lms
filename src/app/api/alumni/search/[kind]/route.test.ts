import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alumni/access", () => ({ authorizeAlumni: vi.fn() }));
vi.mock("@/lib/alumni/reference", () => ({ searchColleges: vi.fn(), searchBranches: vi.fn() }));

import { authorizeAlumni } from "@/lib/alumni/access";
import { searchBranches, searchColleges } from "@/lib/alumni/reference";
import { GET } from "./route";

const call = (kind: string, q = "nit") =>
  GET(new Request(`http://localhost/api/alumni/search/${kind}?q=${encodeURIComponent(q)}`), { params: Promise.resolve({ kind }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "a@x", permission: {} as never });
  vi.mocked(searchColleges).mockResolvedValue([{ code: "U-0237", name: "NIT Karnataka", meta: "" }]);
  vi.mocked(searchBranches).mockResolvedValue([{ code: "CSIT057", name: "CSE", meta: "" }]);
});

describe("GET /api/alumni/search/[kind]", () => {
  it("needs alumni access", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) as never });
    expect((await call("college")).status).toBe(401);
    expect(searchColleges).not.toHaveBeenCalled();
  });

  it("searches colleges or branches", async () => {
    expect((await (await call("college", "nit surathkal")).json()).results[0].code).toBe("U-0237");
    expect(searchColleges).toHaveBeenCalledWith("nit surathkal");
    expect((await (await call("branch", "cse")).json()).results[0].code).toBe("CSIT057");
  });

  it("404 for anything else, 500 when the search fails", async () => {
    expect((await call("school")).status).toBe(404);
    vi.mocked(searchColleges).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call("college")).status).toBe(500);
  });
});
