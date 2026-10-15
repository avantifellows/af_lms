import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { LMS_VIEWS, matchView } from "./views";

const routeFile = (viewPath: string) =>
  path.join(process.cwd(), "src/app", viewPath, "route.ts");

describe("LMS_VIEWS allow-list", () => {
  it.each(LMS_VIEWS.map((v) => v.path))(
    "%s resolves identity through getSession, not the raw request",
    (viewPath) => {
      // An in-process MCP call carries no LMS cookie: a handler reading
      // getServerSession directly would see the outer request, not the caller.
      expect(readFileSync(routeFile(viewPath), "utf8")).not.toMatch(/getServerSession/);
    },
  );

  it("exposes GET handlers only", () => {
    for (const view of LMS_VIEWS) expect(typeof view.handler).toBe("function");
  });
});

describe("matchView", () => {
  it("matches a static path", () => {
    expect(matchView("/api/curriculum/progress")?.view.path).toBe("/api/curriculum/progress");
  });

  it("fills path parameters and ignores a trailing slash or query", () => {
    const match = matchView("/api/quiz-analytics/2332%200/grades/?x=1");
    expect(match?.view.path).toBe("/api/quiz-analytics/[udise]/grades");
    expect(match?.params).toEqual({ udise: "2332 0" });
  });

  it("refuses paths outside the allow-list", () => {
    expect(matchView("/api/admin/users")).toBeNull();
    expect(matchView("/api/quiz-analytics/123/student-questions")).toBeNull();
    expect(matchView("/api/quiz-analytics//grades")).toBeNull();
  });
});
