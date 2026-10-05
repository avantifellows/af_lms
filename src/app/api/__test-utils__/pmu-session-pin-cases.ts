/**
 * Shared cases for the PMU session pin on Performance routes that read a
 * caller-named test session (`refusePmuSessionOr502`). Call it from a route
 * test file that mocks `@/lib/bigquery` (including `isSessionOnlyForProgram`)
 * and `@/lib/api-auth`.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  PMU_GOVT_PERMISSION,
  PMU_MANAGER_PERMISSION,
  routeParams,
} from "./api-test-helpers";

type RouteGet = (
  request: Request,
  ctx: { params: Promise<{ udise: string }> }
) => Promise<Response>;

interface SessionPinCaseOptions {
  /** Route segment under /api/quiz-analytics/[udise]/, e.g. "test-deep-dive". */
  route: string;
  GET: RouteGet;
  /** `authorizeSchoolAccess` mock; resolves as authorized for `school`. */
  auth: Mock;
  school: { id: string; code: string; name: string; region: string };
  /** Arranges the route's data mocks so a permitted call answers 200. */
  arrangeData: () => void;
  /** `isSessionOnlyForProgram` mock. */
  sessionPin: Mock;
  /** Data reads that must not run when the pin refuses. */
  dataReads: Mock[];
}

const UDISE = "1234";

// A Program Manager on JNV CoE: never consults the pin.
const CO_E_PM_PERMISSION = {
  email: "pm@avantifellows.org",
  level: 3 as const,
  role: "program_manager" as const,
  school_codes: null,
  regions: null,
  program_ids: [1],
  read_only: false,
};

function request(route: string, sessionId: string, program?: string) {
  const url = new URL(`http://localhost/api/quiz-analytics/${UDISE}/${route}`);
  url.searchParams.set("grade", "11");
  url.searchParams.set("sessionId", sessionId);
  if (program !== undefined) url.searchParams.set("program", program);
  return new Request(url.toString());
}

function harness(opts: SessionPinCaseOptions) {
  const { route, GET, auth, school, arrangeData, sessionPin, dataReads } = opts;
  return {
    arrangeAs: (permission: { role: string }, sessionIsNvs: boolean) => {
      auth.mockResolvedValue({ authorized: true, school, readOnly: false, permission });
      arrangeData();
      sessionPin.mockResolvedValue(sessionIsNvs);
    },
    call: (sessionId: string, program?: string) =>
      GET(request(route, sessionId, program), routeParams({ udise: UDISE })),
    expectNoDataRead: () => {
      for (const read of dataReads) expect(read).not.toHaveBeenCalled();
    },
  };
}

export function describePmuSessionPin(opts: SessionPinCaseOptions) {
  const { route, sessionPin } = opts;
  const { arrangeAs, call, expectNoDataRead } = harness(opts);

  // The program pin alone lets a PMU caller name a CoE/Nodal session; the
  // session must itself be a JNV NVS test at this School.
  describe.each([
    ["PMU Manager", PMU_MANAGER_PERMISSION],
    ["PMU Govt School User", PMU_GOVT_PERMISSION],
  ])(`${route} session pin as %s`, (_label, permission) => {
    beforeEach(() => arrangeAs(permission, true));

    it("serves a JNV NVS session after checking it at this School", async () => {
      const res = await call("nvs_session");
      expect(res.status).toBe(200);
      expect(sessionPin).toHaveBeenCalledWith(UDISE, "nvs_session", "JNV NVS");
    });

    it("403s a session that is not a JNV NVS test, before any data read", async () => {
      sessionPin.mockResolvedValue(false);
      const res = await call("coe_session");
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: "Access denied" });
      expect(sessionPin).toHaveBeenCalledWith(UDISE, "coe_session", "JNV NVS");
      expectNoDataRead();
    });

    it("502s (fails closed) when the session lookup fails", async () => {
      sessionPin.mockRejectedValue(new Error("bq down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await call("nvs_session");
      expect(res.status).toBe(502);
      expectNoDataRead();
      errorSpy.mockRestore();
    });
  });

  describe(`${route} session pin for other roles`, () => {
    // The session would refuse a PMU caller; it must not matter here.
    beforeEach(() => arrangeAs(CO_E_PM_PERMISSION, false));

    it("serves a non-NVS session without a session lookup", async () => {
      const res = await call("coe_session", "JNV CoE");
      expect(res.status).toBe(200);
      expect(sessionPin).not.toHaveBeenCalled();
    });
  });
}
