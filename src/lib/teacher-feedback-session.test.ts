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
  group: "EnableStudents",
  authType: "ID,DOB",
  parentBatchId: "EnableStudents_11",
  classBatchIds: ["EnableStudents_11_A", "EnableStudents_11_B"],
  grade: 11,
  stream: "pcm",
  course: "JEE",
  sourceId: "teacher-feedback:v2:34054:2026-06",
  startTimeUtc: "2026-06-22T00:00:00Z",
  endTimeUtc: "2026-06-23T00:00:00Z",
  name: "Student Feedback - Jun 2026 - JNV Palghar - Manjit Kumar",
  createdBy: "pm@avantifellows.org",
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
    const meta = buildFeedbackSessionPayload(baseParams).meta_data as Record<string, unknown>;
    expect(meta.test_type).toBe("form");
    expect(meta.test_format).toBe("questionnaire");
    expect(meta.test_purpose).toBe("one_time");
    expect(meta.group).toBe("EnableStudents");
    expect(meta.batch_id).toBe("EnableStudents_11_A,EnableStudents_11_B");
    expect(meta.cms_test_id).toBe("teacher-feedback:v2:34054:2026-06");
    expect(meta.show_scores).toBe(false);
    expect(meta.single_page_mode).toBe(true);
  });

  it("leaves launch fields blank — the Lambda fills them after building the quiz", async () => {
    const { buildFeedbackSessionPayload } = await import("./teacher-feedback-session");
    const payload = buildFeedbackSessionPayload(baseParams);
    expect(payload.auth_type).toBe("ID,DOB"); // from the group, not hardcoded
    expect(payload.session_id).toBe("");
    expect(payload.platform_id).toBe("");
    expect(payload.platform_link).toBe("");
    expect(payload.portal_link).toBe("");
    const meta = payload.meta_data as Record<string, unknown>;
    // No chaining.
    expect(meta.next_step_url).toBe("");
    expect(meta.admin_testing_link).toBe("");
  });

  it("carries the feedback traceability namespace", async () => {
    const { buildFeedbackSessionPayload } = await import("./teacher-feedback-session");
    const meta = buildFeedbackSessionPayload(baseParams).meta_data as Record<string, unknown>;
    expect(meta.feedback_teacher_id).toBe("42");
    expect(meta.feedback_teacher_name).toBe("Manjit Kumar");
    expect(meta.feedback_cycle_label).toBe("Jun 2026");
    expect(meta.feedback_school_code).toBe("34054");
  });

  it("truncates the session name to 255 chars", async () => {
    const { buildFeedbackSessionPayload } = await import("./teacher-feedback-session");
    const payload = buildFeedbackSessionPayload({ ...baseParams, name: "x".repeat(300) });
    expect((payload.name as string).length).toBe(255);
  });
});

describe("createFeedbackSession", () => {
  it("POSTs one /session and returns its pk (Lambda does the rest)", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 17221 }));

    const { createFeedbackSession } = await import("./teacher-feedback-session");
    const result = await createFeedbackSession(baseParams);

    expect(result).toEqual({ sessionPk: 17221 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://db.test/api/session");
  });

  it("throws if the session POST fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "x" }, 500));
    const { createFeedbackSession } = await import("./teacher-feedback-session");
    await expect(createFeedbackSession(baseParams)).rejects.toThrow(/create session/);
  });

  it("throws when the session POST returns no id", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const { createFeedbackSession } = await import("./teacher-feedback-session");
    await expect(createFeedbackSession(baseParams)).rejects.toThrow(/no id/);
  });

  it("throws when DB service is not configured", async () => {
    vi.stubEnv("DB_SERVICE_URL", "");
    const { createFeedbackSession } = await import("./teacher-feedback-session");
    await expect(createFeedbackSession(baseParams)).rejects.toThrow(/DB service/);
  });
});
