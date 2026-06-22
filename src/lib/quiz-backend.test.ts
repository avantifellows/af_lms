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

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("QUIZ_BACKEND_URL", "https://quiz-backend.test");
  vi.stubEnv("QUIZ_AF_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createFormQuiz", () => {
  it("POSTs the quiz body to {QUIZ_BACKEND_URL}/quiz and returns the id", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "quiz_abc" }));
    const { createFormQuiz } = await import("./quiz-backend");

    const result = await createFormQuiz({ title: "T", question_sets: [] });

    expect(result).toEqual({ id: "quiz_abc" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://quiz-backend.test/quiz");
    expect(opts.method).toBe("POST");
    expect(opts.headers.apiKey).toBe("test-key");
    expect(JSON.parse(opts.body)).toMatchObject({ title: "T" });
  });

  it("throws when QUIZ_BACKEND_URL is unset", async () => {
    vi.stubEnv("QUIZ_BACKEND_URL", "");
    const { createFormQuiz } = await import("./quiz-backend");
    await expect(createFormQuiz({})).rejects.toThrow(/QUIZ_BACKEND_URL/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on a non-OK response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "bad" }, 500));
    const { createFormQuiz } = await import("./quiz-backend");
    await expect(createFormQuiz({})).rejects.toThrow(/status 500/);
  });

  it("throws when the response has no usable id", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "" }));
    const { createFormQuiz } = await import("./quiz-backend");
    await expect(createFormQuiz({})).rejects.toThrow(/quiz id/);
  });

  it("omits the apiKey header when no key is configured", async () => {
    vi.stubEnv("QUIZ_AF_API_KEY", "");
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: "quiz_xyz" }));
    const { createFormQuiz } = await import("./quiz-backend");
    await createFormQuiz({});
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.apiKey).toBeUndefined();
  });
});
