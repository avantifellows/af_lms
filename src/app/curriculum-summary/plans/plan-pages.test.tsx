import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  requireCurriculumPlanAdmin: vi.fn(),
  listCurriculumPlans: vi.fn(),
  getCurriculumPlan: vi.fn(),
  listCentreCoverage: vi.fn(),
  listPlanAssignmentCentres: vi.fn(),
  checkCurriculumPlansSchema: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/curriculum-plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/curriculum-plans")>()),
  requireCurriculumPlanAdmin: mocks.requireCurriculumPlanAdmin,
  listCurriculumPlans: mocks.listCurriculumPlans,
  getCurriculumPlan: mocks.getCurriculumPlan,
}));
vi.mock("@/lib/curriculum-plan-assignments", () => ({
  listCentreCoverage: mocks.listCentreCoverage,
  listPlanAssignmentCentres: mocks.listPlanAssignmentCentres,
}));
vi.mock("@/lib/curriculum-schema", () => ({
  checkCurriculumPlansSchema: mocks.checkCurriculumPlansSchema,
}));
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
import CurriculumPlanAssignPage from "./[id]/assign/page";

const ADMIN_ACCESS = {
  ok: true,
  email: "admin@avantifellows.org",
  permission: { email: "admin@avantifellows.org", role: "admin", level: 3, read_only: false },
};
const READ_ONLY_ACCESS = {
  ...ADMIN_ACCESS,
  permission: { ...ADMIN_ACCESS.permission, read_only: true },
};
const SCHEMA_UNAVAILABLE = {
  ok: false,
  status: 503,
  error: "LMS curriculum schema unavailable",
  details: ["lms_curriculum_plans.id"],
};
const NOT_FOUND = { ok: false, status: 404, error: "Curriculum Plan not found" };

const PLAN = {
  id: 7,
  title: "G11 2026-27 (Others)",
  academicYear: "2026-2027",
  grade: 11,
  examTracks: ["jee_main", "neet"],
  status: "active",
  displayStatus: "active",
  closureDate: "2027-03-08",
  assignmentCount: 1,
};

function plansPage(searchParams: Record<string, string | undefined> = {}) {
  return CurriculumPlansPage({ searchParams: Promise.resolve(searchParams) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getServerSession.mockResolvedValue({ user: { email: "admin@avantifellows.org" } });
  mocks.requireCurriculumPlanAdmin.mockResolvedValue(ADMIN_ACCESS);
  mocks.listCurriculumPlans.mockResolvedValue({ ok: true, plans: [PLAN] });
  mocks.checkCurriculumPlansSchema.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plan page access", () => {
  it.each([
    [401, "REDIRECT:/"],
    [403, "REDIRECT:/dashboard"],
  ])("sends a %s to %s", async (status, redirect) => {
    mocks.requireCurriculumPlanAdmin.mockResolvedValue({ ok: false, status, error: "No" });

    await expect(plansPage()).rejects.toThrow(redirect);
    await expect(NewCurriculumPlanPage()).rejects.toThrow(redirect);
    await expect(CurriculumPlanEditorPage({ params: Promise.resolve({ id: "7" }) })).rejects.toThrow(redirect);
    await expect(CurriculumPlanAssignPage({ params: Promise.resolve({ id: "7" }) })).rejects.toThrow(redirect);
    expect(mocks.listCurriculumPlans).not.toHaveBeenCalled();
  });
});

describe("Curriculum Plans list page", () => {
  it("lists the academic year's plans with status, closure date and assignment count", async () => {
    render(await plansPage({ academic_year: "2026-2027", grade: "11" }));

    expect(mocks.listCurriculumPlans).toHaveBeenCalledWith({ academicYear: "2026-2027", grade: 11 });
    const row = screen.getByRole("row", { name: /G11 2026-27 \(Others\)/ });
    expect(within(row).getByRole("link", { name: "G11 2026-27 (Others)" })).toHaveAttribute(
      "href",
      "/curriculum-summary/plans/7"
    );
    expect(row).toHaveTextContent("JEE Main, NEET");
    expect(row).toHaveTextContent("Active");
    expect(row).toHaveTextContent("2027-03-08");
    expect(screen.getByLabelText("Grade")).toHaveValue("11");
    expect(screen.getByRole("link", { name: "New plan" })).toHaveAttribute(
      "href",
      "/curriculum-summary/plans/new"
    );
  });

  it("links the tabs with the academic year, keeping the Grade on the Plans tab", async () => {
    render(await plansPage({ academic_year: "2026-2027", grade: "12" }));

    const tabs = screen.getByRole("navigation", { name: "Curriculum Plans views" });
    expect(within(tabs).getByRole("link", { name: "Plans" })).toHaveAttribute(
      "href",
      "/curriculum-summary/plans?academic_year=2026-2027&grade=12"
    );
    expect(within(tabs).getByRole("link", { name: "Plans" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Centre coverage" })).toHaveAttribute(
      "href",
      "/curriculum-summary/plans?academic_year=2026-2027&tab=coverage"
    );
  });

  // Back / Forward changes the URL under a mounted page; the filter controls must show the new
  // URL, not what was last typed or picked.
  it("re-renders the filter controls from the URL when it changes", async () => {
    const { rerender } = render(await plansPage({ academic_year: "2026-2027", grade: "11" }));
    fireEvent.change(screen.getByLabelText("Academic year"), { target: { value: "unapplied" } });
    fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "12" } });

    rerender(await plansPage({ academic_year: "2027-2028" }));

    expect(screen.getByLabelText("Academic year")).toHaveValue("2027-2028");
    expect(screen.getByLabelText("Grade")).toHaveValue("");

    // A page brought back from the back/forward cache drops edits that were never applied.
    fireEvent.change(screen.getByLabelText("Academic year"), { target: { value: "unapplied" } });
    fireEvent.change(screen.getByLabelText("Grade"), { target: { value: "11" } });
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(screen.getByLabelText("Academic year")).toHaveValue("2027-2028");
    expect(screen.getByLabelText("Grade")).toHaveValue("");
  });

  it("says when the academic year has no plans", async () => {
    mocks.listCurriculumPlans.mockResolvedValue({ ok: true, plans: [] });

    render(await plansPage({ academic_year: "2027-2028" }));

    expect(screen.getByText("No Curriculum Plans for 2027-2028.")).toBeInTheDocument();
  });

  it("disables New plan for a read-only Admin", async () => {
    mocks.requireCurriculumPlanAdmin.mockResolvedValue(READ_ONLY_ACCESS);

    render(await plansPage());

    expect(screen.getByRole("button", { name: "New plan" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "New plan" })).not.toBeInTheDocument();
  });

  it("shows Centre coverage on the coverage tab, without the Grade filter", async () => {
    mocks.listCentreCoverage.mockResolvedValue({
      ok: true,
      academicYear: "2026-2027",
      plans: [PLAN],
      centres: [
        {
          centreId: 1,
          centreName: "Anand Nodal",
          schoolName: "JNV Anand",
          region: "NORTH",
          programName: "JNV Nodal",
          grades: {
            11: { mappedTracks: ["jee_main"], plan: { id: 7, title: PLAN.title, displayStatus: "active" }, uncoveredTracks: [] },
            12: null,
          },
        },
      ],
    });

    render(await plansPage({ tab: "coverage", academic_year: "2026-2027" }));

    expect(mocks.listCentreCoverage).toHaveBeenCalledWith("2026-2027");
    expect(mocks.listCurriculumPlans).not.toHaveBeenCalled();
    expect(screen.getByText("Anand Nodal")).toBeInTheDocument();
    expect(screen.queryByLabelText("Grade")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Centre coverage" })).toHaveAttribute("aria-current", "page");
  });

  it.each([
    [{}, "listCurriculumPlans"],
    [{ tab: "coverage" }, "listCentreCoverage"],
  ] as const)("shows the schema-unavailable state (%j)", async (searchParams, loader) => {
    mocks[loader].mockResolvedValue(SCHEMA_UNAVAILABLE);

    render(await plansPage(searchParams));

    expect(screen.getByText("Schema unavailable")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "LMS curriculum schema unavailable" })).toBeInTheDocument();
    expect(screen.getByText("lms_curriculum_plans.id")).toBeInTheDocument();
    expect(screen.getByText("Curriculum Plans cannot load until the Curriculum Plan tables are available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });
});

describe("plan editor page", () => {
  it("is a 404 for a plan that does not exist", async () => {
    mocks.getCurriculumPlan.mockResolvedValue(NOT_FOUND);

    await expect(CurriculumPlanEditorPage({ params: Promise.resolve({ id: "999" }) })).rejects.toThrow(
      "NOT_FOUND"
    );
  });

  it.each([
    [1, "1 Centre assigned"],
    [3, "3 Centres assigned"],
  ])("shows the plan with %s assignment(s)", async (assignmentCount, text) => {
    mocks.getCurriculumPlan.mockResolvedValue({
      ok: true,
      plan: { ...PLAN, assignmentCount, chapters: [] },
    });

    render(await CurriculumPlanEditorPage({ params: Promise.resolve({ id: "7" }) }));

    expect(mocks.getCurriculumPlan).toHaveBeenCalledWith(7);
    expect(screen.getByRole("heading", { name: PLAN.title })).toBeInTheDocument();
    expect(screen.getByText("Grade 11 · 2026-2027")).toBeInTheDocument();
    expect(screen.getByTestId("plan-assignment-count")).toHaveTextContent(text);
    expect(screen.getByRole("link", { name: "Assign Centres" })).toHaveAttribute(
      "href",
      "/curriculum-summary/plans/7/assign"
    );
  });
});

describe("assign page", () => {
  it("is a 404 for a plan that does not exist", async () => {
    mocks.listPlanAssignmentCentres.mockResolvedValue(NOT_FOUND);

    await expect(CurriculumPlanAssignPage({ params: Promise.resolve({ id: "999" }) })).rejects.toThrow(
      "NOT_FOUND"
    );
  });

  it("names the plan, its Grade and academic year", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mocks.listPlanAssignmentCentres.mockResolvedValue({
      ok: true,
      plan: { id: 7, title: PLAN.title, academicYear: "2026-2027", grade: 11 },
      centres: [],
    });

    const { container } = render(await CurriculumPlanAssignPage({ params: Promise.resolve({ id: "7" }) }));

    expect(screen.getByRole("heading", { name: `Assign ${PLAN.title}` })).toBeInTheDocument();
    expect(screen.getByText("Grade 11 · 2026-2027")).toBeInTheDocument();
    expect(container.querySelector('a[href="/curriculum-summary/plans/7"]')).not.toBeNull();
  });

  it("shows the schema-unavailable state under a generic heading", async () => {
    mocks.listPlanAssignmentCentres.mockResolvedValue(SCHEMA_UNAVAILABLE);

    render(await CurriculumPlanAssignPage({ params: Promise.resolve({ id: "7" }) }));

    expect(screen.getByRole("heading", { name: "Assign Curriculum Plan" })).toBeInTheDocument();
    expect(screen.getByText("Schema unavailable")).toBeInTheDocument();
    expect(screen.getByText("lms_curriculum_plans.id")).toBeInTheDocument();
    expect(screen.getByText("Curriculum Plans cannot load until the Curriculum Plan tables are available.")).toBeInTheDocument();
  });
});

describe("new plan page", () => {
  it("starts a Grade 11 plan in the current academic year", async () => {
    render(await NewCurriculumPlanPage());

    expect((screen.getByLabelText("Academic year") as HTMLInputElement).value).toMatch(/^\d{4}-\d{4}$/);
    expect(screen.getByLabelText("Grade")).toHaveValue("11");
    expect(screen.getByRole("button", { name: "Create plan" })).toBeEnabled();
  });
});
