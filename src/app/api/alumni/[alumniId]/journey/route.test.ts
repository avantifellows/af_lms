import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alumni/access", () => ({ authorizeAlumnus: vi.fn() }));
vi.mock("@/lib/alumni/entry", () => ({ getAlumnusContext: vi.fn() }));
vi.mock("@/lib/alumni/journey", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alumni/journey")>();
  return { ...actual, loadJourney: vi.fn(), revertToJourney: vi.fn() };
});

import { NextResponse } from "next/server";
import { authorizeAlumnus } from "@/lib/alumni/access";
import { getAlumnusContext } from "@/lib/alumni/entry";
import { loadJourney, revertToJourney } from "@/lib/alumni/journey";
import { GET } from "./route";
import { POST } from "./revert/route";

const params = { params: Promise.resolve({ alumniId: "8340" }) };
const revert = (body: unknown) =>
  POST(new Request("http://localhost/api/alumni/8340/journey/revert", { method: "POST", body: JSON.stringify(body) }), params);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ALUMNI_JOURNEY", "on");
  vi.mocked(authorizeAlumnus).mockResolvedValue({ ok: true, email: "a@avantifellows.org", role: "alumni_manager" });
  vi.mocked(getAlumnusContext).mockResolvedValue({ ids: { alumniId: "8340" } } as never);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/alumni/[alumniId]/journey", () => {
  it("needs view access to the alumnus", async () => {
    vi.mocked(authorizeAlumnus).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    expect((await GET(new Request("http://localhost"), params)).status).toBe(403);
    expect(authorizeAlumnus).toHaveBeenCalledWith("8340", false);
  });

  it("says history is off without reading anything", async () => {
    vi.stubEnv("ALUMNI_JOURNEY", "");
    expect(await (await GET(new Request("http://localhost"), params)).json()).toEqual({ enabled: false, entries: [] });
    expect(loadJourney).not.toHaveBeenCalled();
  });

  it("returns the entries", async () => {
    vi.mocked(loadJourney).mockResolvedValue({ available: true, entries: [{ id: "1" }] as never });
    expect(await (await GET(new Request("http://localhost"), params)).json()).toEqual({ enabled: true, entries: [{ id: "1" }] });
  });
});

describe("POST /api/alumni/[alumniId]/journey/revert", () => {
  it("needs edit access", async () => {
    vi.mocked(authorizeAlumnus).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    expect((await revert({ journeyId: "7", version: "v2" })).status).toBe(403);
    expect(authorizeAlumnus).toHaveBeenCalledWith("8340", true);
  });

  it("400s a bad body", async () => {
    expect((await revert({ journeyId: "x", version: "v2" })).status).toBe(400);
    expect((await revert({ journeyId: "7" })).status).toBe(400);
    expect(revertToJourney).not.toHaveBeenCalled();
  });

  it("restores as the signed-in person", async () => {
    vi.mocked(revertToJourney).mockResolvedValue({ ok: true, changed: ["Organisation"] });
    const res = await revert({ journeyId: "7", version: "v2" });
    expect(await res.json()).toEqual({ ok: true, changed: ["Organisation"] });
    expect(revertToJourney).toHaveBeenCalledWith(expect.anything(), "7", "v2", {
      actorEmail: "a@avantifellows.org",
      actorRole: "alumni_manager",
    });
  });

  it("passes on a refusal's status", async () => {
    vi.mocked(revertToJourney).mockResolvedValue({ ok: false, status: 409, error: "changed" });
    expect((await revert({ journeyId: "7", version: "v2" })).status).toBe(409);
  });
});
