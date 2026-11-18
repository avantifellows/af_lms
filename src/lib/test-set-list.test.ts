import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The PMU test set list reader with its two edges stubbed: Google auth (the
// service account token) and the Firestore REST fetch.
const { mockGetAccessToken } = vi.hoisted(() => ({ mockGetAccessToken: vi.fn() }));
vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn(function GoogleAuth() {
    return { getAccessToken: mockGetAccessToken, getProjectId: async () => "avantifellows" };
  }),
}));

const mockFetch = vi.fn();

// Firestore REST encodes a document's fields as typed values.
const str = (value: string) => ({ stringValue: value });
const set = (label: unknown, quizIds: unknown[], current = false) => ({
  mapValue: {
    fields: {
      ...(label === undefined ? {} : { label }),
      quiz_ids: { arrayValue: { values: quizIds } },
      current: { booleanValue: current },
    },
  },
});
const document = (sets: unknown[]) => ({
  name: "projects/avantifellows/databases/(default)/documents/pmu_live_tracking_sessions/nvs",
  fields: {
    program_label: str("NVS"),
    test_sets: { arrayValue: { values: sets } },
  },
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

async function freshReader() {
  vi.resetModules();
  return (await import("./test-set-list")).getNvsTestSets;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", JSON.stringify({ project_id: "avantifellows", client_email: "sa@x" }));
  vi.stubGlobal("fetch", mockFetch);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T08:30:00.000Z"));
  mockGetAccessToken.mockResolvedValue("token-1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getNvsTestSets", () => {
  it("reads the NVS test sets from the PMU Live Tracking document, in list order", async () => {
    mockFetch.mockResolvedValue(
      ok(
        document([
          set(str("July"), [str("q-jul-1"), str("q-jul-2")]),
          set(str("August"), [str("q-aug-1")], true),
        ]),
      ),
    );
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toEqual([
      { label: "July", quizIds: ["q-jul-1", "q-jul-2"] },
      { label: "August", quizIds: ["q-aug-1"] },
    ]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://firestore.googleapis.com/v1/projects/avantifellows/databases/(default)/documents/pmu_live_tracking_sessions/nvs",
    );
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: "Bearer token-1" }));
  });

  it("trims labels, trims and de-duplicates quiz ids, and drops sets with no label or no ids", async () => {
    mockFetch.mockResolvedValue(
      ok(
        document([
          set(str("  September "), [str(" q1 "), str("q2"), str("q1"), str("  "), { integerValue: "7" }]),
          set(str("   "), [str("q3")]),
          set(undefined, [str("q4")]),
          set(str("October"), []),
          set(str("November"), [str(" ")]),
          { stringValue: "not a set" },
          set(str("December"), [str("q5")]),
        ]),
      ),
    );
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toEqual([
      { label: "September", quizIds: ["q1", "q2"] },
      { label: "December", quizIds: ["q5"] },
    ]);
  });

  it("ignores the current mark", async () => {
    mockFetch.mockResolvedValue(
      ok(document([set(str("September"), [str("q1")], false), set(str("October"), [str("q2")], true)])),
    );
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toEqual([
      { label: "September", quizIds: ["q1"] },
      { label: "October", quizIds: ["q2"] },
    ]);
  });

  it("returns an empty list when the document holds no sets", async () => {
    mockFetch.mockResolvedValue(ok({ fields: { test_sets: { arrayValue: {} } } }));
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toEqual([]);
  });

  it.each([
    ["an error status", () => mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })],
    ["a network failure", () => mockFetch.mockRejectedValue(new TypeError("fetch failed"))],
    ["a document with no test_sets field", () => mockFetch.mockResolvedValue(ok({ fields: { program_label: str("NVS") } }))],
    ["test_sets that is not a list", () => mockFetch.mockResolvedValue(ok({ fields: { test_sets: str("July") } }))],
    ["a body that is not JSON", () => mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } })],
    ["a failed token", () => mockGetAccessToken.mockRejectedValue(new Error("invalid_grant"))],
  ])("is unavailable after %s", async (_label, fail) => {
    fail();
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toBe("unavailable");
  });

  it("is unavailable when the service account setting is not JSON, without calling Firestore", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", " ");
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toBe("unavailable");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps a read for 5 minutes, then reads again", async () => {
    mockFetch
      .mockResolvedValueOnce(ok(document([set(str("October"), [str("q1")])])))
      .mockResolvedValueOnce(ok(document([set(str("November"), [str("q2")])])));
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toEqual([{ label: "October", quizIds: ["q1"] }]);
    vi.setSystemTime(new Date("2026-11-18T08:34:59.000Z"));
    expect(await getNvsTestSets()).toEqual([{ label: "October", quizIds: ["q1"] }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-11-18T08:35:00.000Z"));
    expect(await getNvsTestSets()).toEqual([{ label: "November", quizIds: ["q2"] }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed read", async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ok(document([set(str("October"), [str("q1")])])));
    const getNvsTestSets = await freshReader();

    expect(await getNvsTestSets()).toBe("unavailable");
    expect(await getNvsTestSets()).toEqual([{ label: "October", quizIds: ["q1"] }]);
  });
});
