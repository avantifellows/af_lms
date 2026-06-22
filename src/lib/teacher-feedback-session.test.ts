import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const baseParams = {
  quizId: "quiz_abc",
  group: "EnableStudents",
  parentBatchId: "EnableStudents_11",
  classBatchIds: ["EnableStudents_11_A", "EnableStudents_11_B"],
  grade: 11,
  stream: "pcm",
  course: "JEE",
  sourceId: "teacher-feedback:v2:34054:2026-06",
  startTimeUtc: "2026-06-22T00:00:00Z",
  endTimeUtc: "2026-06-23T00:00:00Z",
  portalBaseUrl: "https://auth.avantifellows.org/",
  name: "Student Feedback - Jun 2026 - JNV Palghar - Manjit Kumar",
  createdBy: "pm@avantifellows.org",
  nextStepUrl: "https://auth.avantifellows.org/?sessionId=NEXT",
  nextStepText: "Continue to next teacher feedback",
  feedback: {
    teacherId: "42",
    teacherName: "Manjit Kumar",
    teacherOrder: 1,
    cycleLabel: "Jun 2026",
    schoolCode: "34054",
  },
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("DB_SERVICE_URL", "https://db.test/api");
  vi.stubEnv("DB_SERVICE_TOKEN", "tok");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildFeedbackSessionPayload", () => {
  it("uses canonical quiz-creator meta_data values (no feedback purpose)", async () => {
    const { buildFeedbackSessionPayload } = await import("./teacher-feedback-session");
    const payload = buildFeedbackSessionPayload(baseParams);
    const meta = payload.meta_data as Record<string, unknown>;
    expect(meta.test_type).toBe("form");
    expect(meta.test_format).toBe("questionnaire");
    expect(meta.test_purpose).toBe("one_time");
    expect(meta.group).toBe("EnableStudents");
    expect(meta.batch_id).toBe("EnableStudents_11_A,EnableStudents_11_B");
    expect(meta.cms_test_id).toBe("teacher-feedback:v2:34054:2026-06");
    expect(meta.show_scores).toBe(false);
    expect(meta.single_page_mode).toBe(true);
  });

  it("pre-fills launch fields since the Lambda is not in the loop", async () => {
    const { buildFeedbackSessionPayload } = await import("./teacher-feedback-session");
    const payload = buildFeedbackSessionPayload(baseParams);
    expect(payload.session_id).toBe("EnableStudents_quiz_abc");
    expect(payload.platform_id).toBe("quiz_abc");
    expect(payload.platform_link).toBe("quiz_abc");
    expect(payload.portal_link).toBe(
      "https://auth.avantifellows.org/?sessionId=EnableStudents_quiz_abc"
    );
  });

  it("carries the feedback traceability namespace + chaining", async () => {
    const { buildFeedbackSessionPayload } = await import("./teacher-feedback-session");
    const meta = (buildFeedbackSessionPayload(baseParams).meta_data) as Record<string, unknown>;
    expect(meta.feedback_teacher_id).toBe("42");
    expect(meta.feedback_teacher_name).toBe("Manjit Kumar");
    expect(meta.feedback_cycle_label).toBe("Jun 2026");
    expect(meta.feedback_school_code).toBe("34054");
    expect(meta.next_step_url).toBe("https://auth.avantifellows.org/?sessionId=NEXT");
  });

  it("truncates the session name to 255 chars", async () => {
    const { buildFeedbackSessionPayload } = await import("./teacher-feedback-session");
    const payload = buildFeedbackSessionPayload({ ...baseParams, name: "x".repeat(300) });
    expect((payload.name as string).length).toBe(255);
  });
});

describe("createFeedbackSession", () => {
  it("creates session, attaches to group, and creates an occurrence", async () => {
    // 1) POST /session -> { id }
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 17221 }));
    // 2) GET /batch?batch_id= -> [{ id }]
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 555 }]));
    // 3) GET /group/?child_id=&type=batch -> [{ id }]
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 999 }]));
    // 4) POST /group-session -> ok
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));
    // 5) POST /session-occurrence -> ok
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 2 }));

    const { createFeedbackSession } = await import("./teacher-feedback-session");
    const result = await createFeedbackSession(baseParams);

    expect(result).toEqual({
      sessionPk: 17221,
      sessionId: "EnableStudents_quiz_abc",
      portalLink: "https://auth.avantifellows.org/?sessionId=EnableStudents_quiz_abc",
    });

    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls[0]).toBe("https://db.test/api/session");
    expect(urls[1]).toContain("/batch?batch_id=EnableStudents_11");
    expect(urls[2]).toContain("/group/?child_id=555&type=batch");
    expect(urls[3]).toBe("https://db.test/api/group-session");
    expect(urls[4]).toBe("https://db.test/api/session-occurrence");

    // group-session POST references the resolved group id + new session pk
    expect(JSON.parse(mockFetch.mock.calls[3][1].body)).toEqual({
      session_id: 17221,
      group_id: 999,
    });
  });

  it("throws if the session POST fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));
    const { createFeedbackSession } = await import("./teacher-feedback-session");
    await expect(createFeedbackSession(baseParams)).rejects.toThrow(/create session/);
  });

  it("throws if the parent batch can't be resolved to a group", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 17221 })); // session ok
    mockFetch.mockResolvedValueOnce(jsonResponse([])); // batch lookup empty
    const { createFeedbackSession } = await import("./teacher-feedback-session");
    await expect(createFeedbackSession(baseParams)).rejects.toThrow(/Batch .* not found/);
  });

  it("throws when DB service is not configured", async () => {
    vi.stubEnv("DB_SERVICE_URL", "");
    const { createFeedbackSession } = await import("./teacher-feedback-session");
    await expect(createFeedbackSession(baseParams)).rejects.toThrow(/DB service/);
  });
});
