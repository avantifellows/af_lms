import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The AI Test Insights Student page (#557). Student access and the card read
// have their own tests; here they are stubbed so the page's own behaviour
// shows: sign-in redirect, not-found on any refusal, the card and the back link.
const { mockResolveAccess, mockReadCard, mockLatestRequest, mockGetServerSession, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockResolveAccess: vi.fn(),
  mockReadCard: vi.fn(),
  mockLatestRequest: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// The page's client sections refresh it after a Session Notes submit (#575).
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/ai-test-insights-access", () => ({ resolveAiTestInsightsStudentAccess: mockResolveAccess }));
vi.mock("@/lib/ai-test-insights-student-card", () => ({ readAiTestInsightsStudentCard: mockReadCard }));
vi.mock("@/lib/ai-test-insights-requests", () => ({ latestRequest: mockLatestRequest }));

import AiTestInsightsStudentPage from "./page";

const CONTEXT = {
  studentId: 1005,
  userId: 5005,
  school: { id: 9, code: "JNV001", udise: "29000000001" },
  centreId: 302,
  programId: 2,
  grade: 11,
  canEdit: true,
};

const CARD = {
  name: "Esha Ekka",
  studentCode: "STU1005",
  grade: 11,
  batches: ["JNV Nodal 11"],
  gender: "Female",
  category: "ST",
  stream: "engineering",
  insightSessionsCompleted: 2,
  lastInsightSessionDate: "2026-10-01",
};

/** The URLs the page's client cards asked for. */
const askedUrls = () =>
  vi.mocked(fetch).mock.calls.map(([input]) => new URL(String(input), "http://localhost"));

async function renderPage(studentId: string, search: Record<string, string | string[]> = {}) {
  const page = await AiTestInsightsStudentPage({
    params: Promise.resolve({ studentId }),
    searchParams: Promise.resolve(search),
  });
  render(page);
}

const refusal = (status: number) => ({ authorized: false, status, response: new Response(null, { status }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: "teacher@avantifellows.org" } });
  mockResolveAccess.mockResolvedValue({ authorized: true, student: CONTEXT, centreNamedByPage: false });
  mockReadCard.mockResolvedValue(CARD);
  mockLatestRequest.mockResolvedValue(null);
  // The performance card fetches the Student Report; by default it never answers.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI Test Insights Student page", () => {
  it("shows the Student card from the Student's context", async () => {
    await renderPage("1005");

    expect(mockResolveAccess).toHaveBeenCalledWith("1005", { centre: null });
    expect(mockReadCard).toHaveBeenCalledWith(CONTEXT);
    const card = screen.getByRole("region", { name: "Student" });
    expect(within(card).getByRole("heading", { name: "Esha Ekka" })).toBeInTheDocument();
    expect(within(card).getByText("STU1005")).toBeInTheDocument();
    expect(within(card).getByText("JNV Nodal 11")).toBeInTheDocument();
  });

  it("asks the Student Report for the Student's School UDISE, Grade, Program label and user id", async () => {
    await renderPage("1005");

    const performance = screen.getByRole("region", { name: "Performance" });
    expect(within(performance).getByText("Loading test results…")).toBeInTheDocument();
    const reports = askedUrls().filter((url) => url.pathname.endsWith("/student-report"));
    expect(reports).toHaveLength(1);
    const [url] = reports;
    expect(url.pathname).toBe("/api/quiz-analytics/29000000001/student-report");
    expect(Object.fromEntries(url.searchParams)).toEqual({ grade: "11", program: "JNV Nodal", student: "5005" });
  });

  it("asks with the School code when the School has no UDISE", async () => {
    mockResolveAccess.mockResolvedValue({
      authorized: true,
      student: { ...CONTEXT, school: { ...CONTEXT.school, udise: null } },
      centreNamedByPage: false,
    });

    await renderPage("1005");

    expect(askedUrls().map((url) => url.pathname)).toContain("/api/quiz-analytics/JNV001/student-report");
  });

  it("keeps the Student card when the Student Report fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) })),
    );

    await renderPage("1005");

    const performance = screen.getByRole("region", { name: "Performance" });
    expect(await within(performance).findByRole("alert")).toHaveTextContent("Test results could not be loaded");
    const card = screen.getByRole("region", { name: "Student" });
    expect(within(card).getByRole("heading", { name: "Esha Ekka" })).toBeInTheDocument();
  });

  it("puts the AI Summary card after the performance card and reads the Student's tests for it once", async () => {
    await renderPage("1005");

    const regions = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(regions).toEqual(["Student", "Performance", "AI Summary", "Session Notes"]);
    const testReads = askedUrls().filter((url) => url.pathname.endsWith("/tests"));
    expect(testReads.map((url) => url.pathname)).toEqual(["/api/ai-test-insights/students/1005/tests"]);
  });

  it("reads a Teacher's Session Notes with the centre only when the page named it", async () => {
    await renderPage("1005");
    mockResolveAccess.mockResolvedValue({ authorized: true, student: CONTEXT, centreNamedByPage: true });
    await renderPage("1005", { centre: "302" });

    const notesReads = askedUrls().filter((url) => url.pathname.endsWith("/sessions"));
    expect(notesReads.map((url) => `${url.pathname}${url.search}`)).toEqual([
      "/api/ai-test-insights/students/1005/sessions",
      "/api/ai-test-insights/students/1005/sessions?centre=302",
    ]);
  });

  it("shows a viewer the test picker read-only", async () => {
    mockResolveAccess.mockResolvedValue({
      authorized: true,
      student: { ...CONTEXT, canEdit: false },
      centreNamedByPage: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        String(input).endsWith("/tests")
          ? Promise.resolve({
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({ tests: [{ id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" }] }),
            })
          : new Promise(() => {}),
      ),
    );

    await renderPage("1005");

    const summary = screen.getByRole("region", { name: "AI Summary" });
    const checkbox = await within(summary).findByRole("checkbox", { name: /Mock Test 1/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Session Notes" })).not.toBeInTheDocument();
  });

  it("keeps the rest of the page when the tests cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) =>
        String(input).endsWith("/tests")
          ? Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({ error: "Tests could not be loaded" }) })
          : new Promise(() => {}),
      ),
    );

    await renderPage("1005");

    const summary = screen.getByRole("region", { name: "AI Summary" });
    expect(await within(summary).findByRole("alert")).toHaveTextContent("Tests could not be loaded");
    const card = screen.getByRole("region", { name: "Student" });
    expect(within(card).getByRole("heading", { name: "Esha Ekka" })).toBeInTheDocument();
    expect(within(card).getByText("unavailable")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Performance" })).getByText("Loading test results…")).toBeInTheDocument();
  });

  it("shows the Student's latest request on the AI Summary card, read on the server", async () => {
    mockLatestRequest.mockResolvedValue({
      requestKey: "key-1",
      state: "running",
      outcomeCode: null,
      selectedTestIds: ["T9"],
      requestedAt: new Date(Date.now() - 65_000).toISOString(),
      requestedByName: "Asha Teacher",
      finishedAt: null,
    });

    await renderPage("1005");

    expect(mockLatestRequest).toHaveBeenCalledWith(1005);
    const summary = screen.getByRole("region", { name: "AI Summary" });
    expect(within(summary).getByText("Writing the AI Summary. This usually takes about 4 minutes.")).toBeInTheDocument();
    expect(within(summary).queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
  });

  it("asks for an AI Summary with the centre the page named", async () => {
    mockResolveAccess.mockResolvedValue({ authorized: true, student: CONTEXT, centreNamedByPage: true });
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>((input) => {
      if (String(input).endsWith("/tests")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ tests: [{ id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" }] }),
        });
      }
      return new Promise(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderPage("1005", { centre: "302" });
    const summary = screen.getByRole("region", { name: "AI Summary" });
    await within(summary).findByRole("checkbox", { name: /Mock Test 1/ });
    within(summary).getByRole("button", { name: "Generate" }).click();

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/ai-test-insights/students/1005/requests?centre=302", expect.anything()),
    );
  });

  it("links back to the School page's AI Test Insights tab when no valid centre was named", async () => {
    await renderPage("1005", { centre: "401" });

    expect(mockResolveAccess).toHaveBeenCalledWith("1005", { centre: "401" });
    expect(screen.getByRole("link", { name: "Back to AI Test Insights" })).toHaveAttribute(
      "href",
      "/school/JNV001?tab=ai_test_insights",
    );
  });

  it("links back to the Centre page's AI Test Insights tab when the named centre lists the Student", async () => {
    mockResolveAccess.mockResolvedValue({ authorized: true, student: CONTEXT, centreNamedByPage: true });

    await renderPage("1005", { centre: ["302", "301"] });

    expect(mockResolveAccess).toHaveBeenCalledWith("1005", { centre: "302" });
    expect(screen.getByRole("link", { name: "Back to AI Test Insights" })).toHaveAttribute(
      "href",
      "/centre/302?tab=ai_test_insights",
    );
  });

  it("sends a visitor with no session to the sign-in page", async () => {
    mockResolveAccess.mockResolvedValue(refusal(401));

    await expect(renderPage("1005")).rejects.toThrow("REDIRECT:/");
    expect(mockReadCard).not.toHaveBeenCalled();
  });

  it.each([422, 403, 404])("renders the not-found page for a %s refusal, whatever the reason", async (status) => {
    mockResolveAccess.mockResolvedValue(refusal(status));

    await expect(renderPage("1005")).rejects.toThrow("NOT_FOUND");
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockReadCard).not.toHaveBeenCalled();
  });

  it("renders the not-found page when the Student is gone by the time the card is read", async () => {
    mockReadCard.mockResolvedValue(null);

    await expect(renderPage("1005")).rejects.toThrow("NOT_FOUND");
  });
});
