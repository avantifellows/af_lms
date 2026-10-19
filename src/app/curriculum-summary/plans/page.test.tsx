import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockGetUserPermission, mockQuery, mockCheckSchema } = vi.hoisted(
  () => ({
    mockGetServerSession: vi.fn(),
    mockGetUserPermission: vi.fn(),
    mockQuery: vi.fn(),
    mockCheckSchema: vi.fn(),
  })
);

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({ getUserPermission: mockGetUserPermission }));
vi.mock("@/lib/db", () => ({ query: mockQuery, withTransaction: vi.fn() }));
vi.mock("@/lib/curriculum-schema", () => ({ checkCurriculumPlansSchema: mockCheckSchema }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import CurriculumPlansPage from "./page";
import NewCurriculumPlanPage from "./new/page";
import CurriculumPlanEditorPage from "./[id]/page";

beforeEach(() => {
  vi.resetAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { email: "admin@avantifellows.org" } });
  mockGetUserPermission.mockResolvedValue({
    email: "admin@avantifellows.org",
    level: 3,
    role: "admin",
    read_only: false,
  });
  mockCheckSchema.mockResolvedValue({
    ok: false,
    status: 503,
    error: "LMS curriculum schema unavailable",
    details: ["lms_curriculum_plans.id"],
  });
});

describe("Curriculum Plan pages while the plan tables are missing", () => {
  it.each([
    ["plans list", () => CurriculumPlansPage({ searchParams: Promise.resolve({}) })],
    ["new plan", () => NewCurriculumPlanPage()],
    ["plan editor", () => CurriculumPlanEditorPage({ params: Promise.resolve({ id: "7" }) })],
  ])("the %s page shows the schema-unavailable state", async (_name, renderPage) => {
    render(await renderPage());

    expect(screen.getByText("Schema unavailable")).toBeInTheDocument();
    expect(screen.getByText("lms_curriculum_plans.id")).toBeInTheDocument();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
