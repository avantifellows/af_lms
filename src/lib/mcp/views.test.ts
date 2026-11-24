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

describe("student-support redaction", () => {
  const view = (p: string) => LMS_VIEWS.find((v) => v.path === `/api/quiz-analytics/[udise]/${p}`)!;
  const row = { uid: "1", name: "Asha", gender: "Female", category: "OBC", predicted: "M1", mode: "M2" };

  it("drops each student's caste category from the Score journey", () => {
    const body = { tests: [{ sessionId: "t1" }], students: [row, { ...row, uid: "2", category: null }] };
    const out = view("student-support").redact!(body, { includeNotes: false }) as typeof body;
    expect(out.tests).toEqual(body.tests);
    expect(out.students).toEqual([
      { uid: "1", name: "Asha", gender: "Female", predicted: "M1", mode: "M2" },
      { uid: "2", name: "Asha", gender: "Female", predicted: "M1", mode: "M2" },
    ]);
    for (const s of out.students) {
      expect(s).not.toHaveProperty("category");
      expect(s).not.toHaveProperty("predictedPct");
    }
  });

  it("drops the student's caste category from the report, even with notes asked for", () => {
    const body = { student: row, chapters: [], tests: [] };
    const out = view("student-report").redact!(body, { includeNotes: true }) as typeof body;
    expect(out.student).toEqual({ uid: "1", name: "Asha", gender: "Female", predicted: "M1", mode: "M2" });
    expect(out).toMatchObject({ chapters: [], tests: [] });
  });

  it("leaves an unexpected body as it is", () => {
    expect(view("student-support").redact!({ error: "x" }, { includeNotes: false })).toEqual({ error: "x" });
    expect(view("student-report").redact!(null, { includeNotes: false })).toBeNull();
  });
});
