import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/alumni/access", () => ({ authorizeEditWithBody: vi.fn() }));
vi.mock("@/lib/alumni/bulk", () => ({ BULK_MAX: 25, COMMON_MAX: 5000, runBulk: vi.fn(), loadCommonAnswers: vi.fn() }));

import { NextResponse } from "next/server";
import { authorizeEditWithBody } from "@/lib/alumni/access";
import { loadCommonAnswers, runBulk } from "@/lib/alumni/bulk";
import type { UserPermission } from "@/lib/permissions";
import { POST as common } from "./common/route";
import { POST as bulk } from "./route";

const PERM = { email: "a@x", level: 3, role: "admin" } as UserPermission;
const req = () => new Request("http://localhost/api/alumni/bulk", { method: "POST" });
const withBody = (body: unknown) =>
  vi.mocked(authorizeEditWithBody).mockResolvedValue({ ok: true, email: "a@x", permission: PERM, body });
const targets = [{ kind: "alumnus", id: "8340" }];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/alumni/bulk", () => {
  it("passes on a refusal (no edit access, bad JSON)", async () => {
    vi.mocked(authorizeEditWithBody).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    expect((await bulk(req())).status).toBe(403);
    expect(runBulk).not.toHaveBeenCalled();
  });

  it("400s bad students, and a request with no answer", async () => {
    withBody({ targets: [], values: {} });
    expect((await bulk(req())).status).toBe(400);
    withBody({ targets, values: {} });
    expect(await (await bulk(req())).json()).toEqual({ error: "Fill in at least one answer." });
  });

  it("runs the request as the person", async () => {
    vi.mocked(runBulk).mockResolvedValue([{ result: "update" }] as never);
    withBody({ targets, values: { ug_status: "Studying" } });
    expect(await (await bulk(req())).json()).toEqual({ results: [{ result: "update" }] });
    expect(runBulk).toHaveBeenCalledWith(expect.objectContaining({ targets, dryRun: true }), "a@x", PERM);
  });
});

describe("POST /api/alumni/bulk/common", () => {
  it("passes on a refusal; 400s bad students", async () => {
    vi.mocked(authorizeEditWithBody).mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    expect((await common(req())).status).toBe(401);
    withBody({ targets: "all" });
    expect((await common(req())).status).toBe(400);
  });

  it("returns what the students share; 500 when that fails", async () => {
    vi.mocked(loadCommonAnswers).mockResolvedValue({ total: 1 } as never);
    withBody({ targets });
    expect(await (await common(req())).json()).toEqual({ total: 1 });

    vi.mocked(loadCommonAnswers).mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await common(req())).status).toBe(500);
  });
});
