import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ withTransaction: vi.fn() }));
vi.mock("@/lib/intervention-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/intervention-flags")>();
  return { ...actual, authorizeInterventionFlags: vi.fn(), addFlagUpdate: vi.fn() };
});

import { withTransaction } from "@/lib/db";
import {
  InterventionFlagError,
  addFlagUpdate,
  authorizeInterventionFlags,
} from "@/lib/intervention-flags";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";
import { POST } from "./route";

const mockAddFlagUpdate = vi.mocked(addFlagUpdate);
const SCHOOL = { id: "7", code: "70705", udise_code: null, name: "JNV Test", region: null };
const ACTOR = { email: "teacher@avantifellows.org", userId: 42, permission: {} as never };

function post(flagId: string, body: unknown) {
  return POST(
    new NextRequest("http://localhost", { method: "POST", body: JSON.stringify(body) }),
    routeParams({ code: "70705", flagId }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(withTransaction).mockImplementation((fn) => fn({} as never));
  vi.mocked(authorizeInterventionFlags).mockResolvedValue({ ok: true, actor: ACTOR, school: SCHOOL });
});

describe("POST /api/schools/[code]/intervention-flags/[flagId]/updates", () => {
  it("validates the flag id, resolve flag and note", async () => {
    expect((await post("x", { note: "hi" })).status).toBe(400);
    expect((await post("9", { note: "hi", resolve: "yes" })).status).toBe(400);
    expect((await post("9", { note: "" })).status).toBe(400);
    expect(mockAddFlagUpdate).not.toHaveBeenCalled();
  });

  it("resolves without a note", async () => {
    mockAddFlagUpdate.mockResolvedValue({ status: "resolved" });

    const res = await post("9", { resolve: true });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "resolved" });
    expect(mockAddFlagUpdate).toHaveBeenCalledWith(expect.anything(), {
      flagId: 9, schoolId: "7", actor: ACTOR, note: "", resolve: true,
    });
  });

  it("maps domain errors to their status", async () => {
    mockAddFlagUpdate.mockRejectedValue(new InterventionFlagError(404, "Flag not found"));
    const res = await post("9", { note: "follow-up" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Flag not found" });
  });
});
