import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alumni/access", () => ({ authorizeAlumni: vi.fn() }));
vi.mock("@/lib/alumni/mass-restore", () => ({ listHistory: vi.fn(), planRestore: vi.fn(), runRestore: vi.fn() }));

import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { listHistory, planRestore, runRestore } from "@/lib/alumni/mass-restore";
import type { UserPermission } from "@/lib/permissions";
import { POST } from "./route";

const perm = (overrides: Partial<UserPermission> = {}) =>
  ({ email: "a@avantifellows.org", level: 3, role: "admin", read_only: false, ...overrides }) as UserPermission;
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/alumni/restore", { method: "POST", body: JSON.stringify(body) }));
const AT = "2026-11-23T11:40:00.000Z";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ALUMNI_JOURNEY", "on");
  vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "a@avantifellows.org", permission: perm() });
  vi.mocked(planRestore).mockResolvedValue({ items: [], addedAfter: [] });
  vi.mocked(runRestore).mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/alumni/restore", () => {
  it("a school needs edit access to that school", async () => {
    await post({ scope: { kind: "school", code: "59525" }, at: AT, dryRun: true });
    expect(authorizeAlumni).toHaveBeenCalledWith({ requireEdit: true, schoolCode: "59525" });
    expect(planRestore).toHaveBeenCalledWith({ kind: "school", code: "59525" }, new Date(AT));
  });

  it("all alumni needs edit access to every school (level 3)", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "m@x", permission: perm({ role: "alumni_manager", level: 1 }) });
    expect((await post({ scope: { kind: "all" }, at: AT, dryRun: true })).status).toBe(403);
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "m@x", permission: perm({ role: "alumni_manager", level: 3 }) });
    expect((await post({ scope: { kind: "all" }, at: AT, dryRun: true })).status).toBe(200);
  });

  it("passes on a refusal (read-only, out of scope)", async () => {
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    expect((await post({ scope: { kind: "school", code: "1" }, at: AT, dryRun: true })).status).toBe(403);
    expect(planRestore).not.toHaveBeenCalled();
  });

  it("400s a bad scope, a future or invalid moment", async () => {
    expect((await post({ scope: { kind: "x" }, at: AT, dryRun: true })).status).toBe(400);
    expect((await post({ scope: { kind: "all" }, at: "2999-01-01T00:00:00Z", dryRun: true })).status).toBe(400);
    expect((await post({ scope: { kind: "all" }, at: "soon", dryRun: true })).status).toBe(400);
  });

  it("lists the history steps, with the same access rules", async () => {
    vi.mocked(listHistory).mockResolvedValue([]);
    const res = await post({ scope: { kind: "school", code: "59525" }, history: true });
    expect(await res.json()).toEqual({ groups: [] });
    expect(listHistory).toHaveBeenCalledWith({ kind: "school", code: "59525" });
    vi.mocked(authorizeAlumni).mockResolvedValue({ ok: true, email: "m@x", permission: perm({ role: "alumni_manager", level: 1 }) });
    expect((await post({ scope: { kind: "all" }, history: true })).status).toBe(403);
  });

  it("is off while alumni history is off", async () => {
    vi.stubEnv("ALUMNI_JOURNEY", "");
    expect((await post({ scope: { kind: "all" }, at: AT, dryRun: true })).status).toBe(404);
  });

  it("restores 1–25 alumni at a time as the signed-in person", async () => {
    expect((await post({ scope: { kind: "all" }, at: AT, alumniIds: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 26 }, (_, i) => String(i + 1));
    expect((await post({ scope: { kind: "all" }, at: AT, alumniIds: tooMany })).status).toBe(400);
    await post({ scope: { kind: "all" }, at: AT, alumniIds: ["8340"] });
    expect(runRestore).toHaveBeenCalledWith({ kind: "all" }, new Date(AT), ["8340"], {
      actorEmail: "a@avantifellows.org",
      actorRole: "admin",
    });
  });
});
