import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI Test Insights Student page (#557). Student access and the card read
// have their own tests; here they are stubbed so the page's own behaviour
// shows: sign-in redirect, not-found on any refusal, the card and the back link.
const { mockResolveAccess, mockReadCard, mockGetServerSession, mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockResolveAccess: vi.fn(),
  mockReadCard: vi.fn(),
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
vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock("@/lib/ai-test-insights-access", () => ({ resolveAiTestInsightsStudentAccess: mockResolveAccess }));
vi.mock("@/lib/ai-test-insights-student-card", () => ({ readAiTestInsightsStudentCard: mockReadCard }));

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
