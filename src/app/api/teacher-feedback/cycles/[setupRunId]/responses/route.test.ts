import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/teacher-feedback-access", () => ({ authenticateTeacherFeedback: vi.fn() }));
vi.mock("@/lib/teacher-feedback-rounds", () => ({
  loadAuthorizedRound: vi.fn(),
  getRoundRoster: vi.fn(),
}));
vi.mock("@/lib/teacher-feedback-bq", () => ({ getRoundResults: vi.fn() }));

import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { getRoundRoster, loadAuthorizedRound } from "@/lib/teacher-feedback-rounds";
import { getRoundResults } from "@/lib/teacher-feedback-bq";
import { GET } from "./route";

const get = () =>
  GET(new Request("http://localhost/x"), { params: Promise.resolve({ setupRunId: "run-1" }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authenticateTeacherFeedback).mockResolvedValue({ ok: true, permission: {} } as never);
  vi.mocked(loadAuthorizedRound).mockResolvedValue({
    ok: true,
    rows: [
      {
        teacher_name: "Asha",
        teacher_order: 1,
        quiz_id: "q1",
        batch_class_ids: ["B27"],
        summary: { concerns: [{ serious: true }, { serious: false }] },
      },
      { teacher_name: "Ravi", teacher_order: 2, quiz_id: "q2", batch_class_ids: ["B27"] },
    ],
  } as never);
  vi.mocked(getRoundRoster).mockResolvedValue([
    { user_id: "1", student_id: "S1", name: "Anil", batch_id: "B27" },
    { user_id: "2", student_id: "S2", name: "Bina", batch_id: "B27" },
  ]);
  const summary = (responseCount: number, percentage: number) => ({ responseCount, percentage, parameters: [] });
  vi.mocked(getRoundResults).mockResolvedValue(
    new Map([
      ["q1", { responders: new Set(["1", "2", "99"]), summary: summary(3, 80) }],
      ["q2", { responders: new Set(["2"]), summary: summary(0, 0) }],
    ])
  );
});

describe("GET /api/teacher-feedback/cycles/:setupRunId/responses", () => {
  it("counts responders per teacher, lists who is pending, and flags outsiders", async () => {
    const res = await get();

    expect(getRoundRoster).toHaveBeenCalledWith(["B27"]);
    expect(getRoundResults).toHaveBeenCalledWith(["q1", "q2"]);
    expect(await res.json()).toEqual({
      teachers: [
        {
          teacherName: "Asha",
          teacherOrder: 1,
          responded: 2,
          total: 2,
          outsideBatches: 1,
          seriousConcerns: 1,
          responseCount: 3,
          percentage: 80,
          notResponded: [],
        },
        {
          teacherName: "Ravi",
          teacherOrder: 2,
          responded: 1,
          total: 2,
          outsideBatches: 0,
          seriousConcerns: 0,
          responseCount: 0,
          percentage: 0,
          notResponded: [{ name: "Anil", studentId: "S1", batchId: "B27" }],
        },
      ],
    });
  });

  it("passes a denied round through", async () => {
    vi.mocked(loadAuthorizedRound).mockResolvedValue({
      ok: false,
      response: Response.json({}, { status: 404 }),
    } as never);
    expect((await get()).status).toBe(404);
    expect(getRoundResults).not.toHaveBeenCalled();
  });

  it("500s when BigQuery fails", async () => {
    vi.mocked(getRoundResults).mockRejectedValue(new Error("bq down"));
    expect((await get()).status).toBe(500);
  });
});
