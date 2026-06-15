import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  mockGetServerSession,
  mockIsAdmin,
  mockRedirect,
  mockGetCentreList,
  mockGetCentreOptionSets,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockGetCentreList: vi.fn(),
  mockGetCentreOptionSets: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({ isAdmin: mockIsAdmin }));
vi.mock("@/lib/centres", () => ({
  getCentreList: mockGetCentreList,
  getCentreOptionSets: mockGetCentreOptionSets,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./CentreGrid", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="centre-grid" data-props={JSON.stringify(props)} />
  ),
}));

import CentresPage from "./page";

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

describe("CentresPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(CentresPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);

    await expect(CentresPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockIsAdmin).toHaveBeenCalledWith("admin@avantifellows.org");
  });

  it("renders Centre grid data for admin users", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockGetCentreList.mockResolvedValue({
      ok: true,
      filters: {
        search: "",
        searchTerms: [],
        active: "all",
        schoolLink: "all",
        typeCode: null,
        categoryCode: null,
        subCategoryCode: null,
        streamCode: null,
        isPhysical: "all",
      },
      rows: [
        {
          id: 1,
          name: "JNV Bhavnagar CoE",
          schoolId: 10,
          typeCode: "coe",
          typeLabel: "CoE",
          typeOptionActive: true,
          categoryCode: "school",
          categoryLabel: "School",
          categoryOptionActive: true,
          subCategoryCode: null,
          subCategoryLabel: null,
          subCategoryOptionActive: null,
          streamCodes: ["jee"],
          streams: [{ code: "jee", label: "JEE", isActive: true }],
          isPhysical: true,
          isActive: true,
          insertedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          school: {
            id: 10,
            name: "JNV Bhavnagar",
            code: "SCH001",
            udiseCode: "24010100101",
            region: "West",
            state: "Gujarat",
            district: "Bhavnagar",
          },
        },
      ],
      summary: {
        totalCentres: 1,
        activeCentres: 1,
        linkedCentres: 1,
        physicalCentres: 1,
      },
      pagination: { page: 1, limit: 25, totalRows: 1, totalPages: 1 },
    });
    mockGetCentreOptionSets.mockResolvedValue({
      ok: true,
      optionSets: [
        {
          id: 1,
          code: "type",
          label: "Centre Type",
          allowMulti: false,
          sortOrder: 1,
          options: [],
        },
      ],
    });

    const jsx = await CentresPage({
      searchParams: {
        search: "barwani",
        active: "true",
        school_link: "linked",
        page: "2",
      },
    });
    render(jsx);

    expect(screen.getByText("Centre Management")).toBeInTheDocument();
    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();
    expect(screen.getByText("Configure options")).toHaveAttribute(
      "href",
      "/admin/centres/config"
    );
    const grid = screen.getByTestId("centre-grid");
    const props = JSON.parse(grid.getAttribute("data-props")!);
    expect(props.initialRows).toHaveLength(1);
    expect(props.initialRows[0].name).toBe("JNV Bhavnagar CoE");
    expect(props.initialSummary.totalCentres).toBe(1);
    expect(props.initialPagination.totalRows).toBe(1);
    expect(props.optionSets[0].code).toBe("type");
    expect(mockGetCentreList).toHaveBeenCalledWith({
      searchParams: {
        search: "barwani",
        active: "true",
        school_link: "linked",
        page: "2",
      },
    });
  });
});
