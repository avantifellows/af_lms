import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockAdd, mockSession } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockAdd: vi.fn(),
  mockSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: mockAccess }));
vi.mock("@/lib/holistic-follow-up-notes", () => ({ addHolisticFollowUpNote: mockAdd }));

import * as routeModule from "./route";
import { POST } from "./route";

const context = { params: Promise.resolve({ studentId: "41", phaseId: "73" }) };
const url = "http://localhost/api/holistic-mentorship/students/41/phases/73/follow-up-notes";
const contextQuery = "?school_code=SCH001&academic_year=2026-2027&program_id=1";

function post(body: unknown, query = contextQuery) {
  return POST(new Request(`${url}${query}`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never, context);
}

const mentorAccess = {
  ok: true,
  email: "Nila.Sen@example.com",
  actorUserId: 9,
  permission: { role: "teacher" },
  canEdit: true,
  school: { id: 4 },
};

describe("Holistic Follow-up Notes API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { email: "Nila.Sen@example.com" } });
    mockAccess.mockResolvedValue(mentorAccess);
  });

  it("saves the current Mentor's Follow-up Note", async () => {
    mockAdd.mockResolvedValue({
      ok: true,
      followUpNote: {
        id: 601,
        submittedAt: "2026-08-03T10:00:00Z",
        authorName: "Nila Sen",
        answers: [
          { key: "challenges", answer: "Exam stress" },
          { key: "action_plan", answer: "Yes, mostly" },
        ],
      },
    });

    const response = await post({
      answers: { challenges: "  Exam stress ", solutions: "   ", action_plan: "Yes, mostly" },
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      followUpNote: {
        id: 601,
        submittedAt: "2026-08-03T10:00:00Z",
        authorName: "Nila Sen",
        answers: [
          { key: "challenges", answer: "Exam stress" },
          { key: "action_plan", answer: "Yes, mostly" },
        ],
      },
    });
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "Nila.Sen@example.com" } },
      "follow_up_note_add",
      { schoolCode: "SCH001", studentId: 41, academicYear: "2026-2027", programId: 1 },
    );
    expect(mockAdd).toHaveBeenCalledWith({
      studentId: 41,
      phaseId: 73,
      schoolId: 4,
      programId: 1,
      academicYear: "2026-2027",
      actorUserId: 9,
      actorEmail: "Nila.Sen@example.com",
      answers: { challenges: "Exam stress", solutions: null, action_plan: "Yes, mostly" },
    });
  });

  it("returns 401 without a session before reading the body", async () => {
    mockSession.mockResolvedValue(null);

    const response = await post("not json");

    expect(response.status).toBe(401);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing School", "?academic_year=2026-2027&program_id=1"],
    ["an invalid Academic Year", "?school_code=SCH001&academic_year=2026&program_id=1"],
    ["a missing Program", "?school_code=SCH001&academic_year=2026-2027"],
  ])("rejects %s before authorization", async (_label, query) => {
    const response = await post({ answers: { challenges: "Exam stress" } }, query);

    expect(response.status).toBe(422);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{"],
    ["a body without answers", { challenges: "Exam stress" }],
    ["answers that are not an object", { answers: ["Exam stress"] }],
  ])("rejects %s before authorization", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Invalid request body" });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["an Admin or Program Manager", 403, "Forbidden"],
    ["a read-only Teacher", 403, "Forbidden"],
    ["a former Mentor", 404, "Not found"],
  ])("passes access denial for %s through without saving", async (_label, status, error) => {
    mockAccess.mockResolvedValue({ ok: false, status, error });

    const response = await post({ answers: { challenges: "Exam stress" } });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it.each([
    ["all-blank answers", { challenges: "", solutions: "", action_plan: "" }, "Answer at least one question"],
    ["whitespace-only answers", { challenges: "  ", solutions: "\n\t" }, "Answer at least one question"],
    ["no answers", {}, "Answer at least one question"],
    ["an unknown question", { challenges: "Exam stress", mood: "Calm" }, "Unknown Follow-up question"],
    ["a non-string answer", { challenges: 42 }, "Follow-up answers must be text"],
    ["an answer of 10,001 characters", { solutions: "a".repeat(10_001) }, "Follow-up answers must be 10,000 characters or fewer"],
  ])("rejects %s without saving", async (_label, answers, error) => {
    const response = await post({ answers });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("accepts an answer of exactly 10,000 characters", async () => {
    mockAdd.mockResolvedValue({ ok: true, followUpNote: { id: 603 } });

    const response = await post({ answers: { solutions: "a".repeat(10_000) } });

    expect(response.status).toBe(201);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      answers: { challenges: null, solutions: "a".repeat(10_000), action_plan: null },
    }));
  });

  it.each([
    [422, "Submit Post-Session Notes first"],
    [404, "Not found"],
    [409, "Student changed; reload before saving"],
  ])("returns the save result status %s", async (status, error) => {
    mockAdd.mockResolvedValue({ ok: false, status, error });

    const response = await post({ answers: { challenges: "Exam stress" } });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it("exports no handler that edits or deletes a Follow-up Note", () => {
    expect(routeModule).not.toHaveProperty("PATCH");
    expect(routeModule).not.toHaveProperty("PUT");
    expect(routeModule).not.toHaveProperty("DELETE");
  });
});
