import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/bigquery", () => ({ isSessionOnlyForProgram: vi.fn() }));

import { isSessionOnlyForProgram } from "@/lib/bigquery";
import {
  refuseOutsidePmuSession,
  refusePmuSessionOr502,
} from "./performance-session-pin";

const mockSessionPin = vi.mocked(isSessionOnlyForProgram);
const PMU = { role: "pmu_manager" };
const PM = { role: "program_manager" };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("refuseOutsidePmuSession", () => {
  it("returns null for other roles without a warehouse lookup", async () => {
    await expect(refuseOutsidePmuSession(PM, "1234", "s1")).resolves.toBeNull();
    await expect(refuseOutsidePmuSession(null, "1234", "s1")).resolves.toBeNull();
    expect(mockSessionPin).not.toHaveBeenCalled();
  });

  it("returns null for a PMU caller on a JNV NVS session", async () => {
    mockSessionPin.mockResolvedValue(true);
    await expect(refuseOutsidePmuSession(PMU, "1234", "s1")).resolves.toBeNull();
    expect(mockSessionPin).toHaveBeenCalledWith("1234", "s1", "JNV NVS");
  });

  it("403s a PMU caller on another session by default, 404s when asked", async () => {
    mockSessionPin.mockResolvedValue(false);
    const denied = await refuseOutsidePmuSession(PMU, "1234", "s1");
    expect(denied?.status).toBe(403);
    const hidden = await refuseOutsidePmuSession(PMU, "1234", "s1", 404);
    expect(hidden?.status).toBe(404);
  });
});

describe("refusePmuSessionOr502", () => {
  it("passes the 403 refusal through", async () => {
    mockSessionPin.mockResolvedValue(false);
    const res = await refusePmuSessionOr502(PMU, "1234", "s1");
    expect(res?.status).toBe(403);
  });

  it("502s when the lookup fails, logging the message only", async () => {
    mockSessionPin.mockRejectedValue(new Error("bq down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await refusePmuSessionOr502(PMU, "1234", "s1");
    expect(res?.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith("PMU session pin lookup failed:", "bq down");
    errorSpy.mockRestore();
  });

  it("returns null for other roles without a warehouse lookup", async () => {
    await expect(refusePmuSessionOr502(PM, "1234", "s1")).resolves.toBeNull();
    expect(mockSessionPin).not.toHaveBeenCalled();
  });
});
