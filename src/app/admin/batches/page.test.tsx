import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks (hoisted) ----

const { mockGetServerSession, mockIsAdmin, mockRedirect, mockFetch } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockIsAdmin: vi.fn(),
    mockRedirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    mockFetch: vi.fn(),
  }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({ isAdmin: mockIsAdmin }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("./BatchList", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="batch-list" data-props={JSON.stringify(props)} />
  ),
}));

// Set env vars BEFORE importing the page module (top-level const capture)
process.env.DB_SERVICE_URL = "https://db.example.com";
process.env.DB_SERVICE_TOKEN = "test-token";

vi.stubGlobal("fetch", mockFetch);

import BatchManagementPage from "./page";

// ---- helpers ----

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

const mockBatches = [
  { id: 1, name: "Batch A", batch_id: "b1", program_id: 64, metadata: null },
  {
    id: 2,
    name: "Batch B",
    batch_id: "b2",
    program_id: 64,
    metadata: { stream: "Science", grade: 11 },
  },
];

function mockFetchSuccess() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockBatches),
  });
}

// ---- tests ----

describe("BatchManagementPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(BatchManagementPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it("redirects to / when session has no email", async () => {
    mockGetServerSession.mockResolvedValue({ user: {} });

    await expect(BatchManagementPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);

    await expect(BatchManagementPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockIsAdmin).toHaveBeenCalledWith("admin@avantifellows.org");
  });

  it("fetches batches and renders BatchList for admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockFetchSuccess();

    const jsx = await BatchManagementPage();
    render(jsx);

    // Header
    expect(screen.getByText("Batch Metadata")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Configure stream and grade metadata for program batches"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();

    // Navigation
    expect(screen.getByText("Back to Admin").closest("a")).toHaveAttribute(
      "href",
      "/admin"
    );

    // BatchList receives correct props
    const batchList = screen.getByTestId("batch-list");
    const props = JSON.parse(batchList.getAttribute("data-props")!);
    expect(props.initialBatches).toEqual(mockBatches);
    expect(props.programs).toEqual([{ id: 64, name: "JNV NVS" }]);
    expect(props.initialProgramId).toBe(64);

    // Verify fetch was called with correct URL pattern and options
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("/batch?program_id=64");
    expect(options).toEqual(
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("Bearer"),
        }),
      })
    );
  });

  it("passes empty batches when fetch fails", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockFetch.mockResolvedValue({ ok: false });

    const jsx = await BatchManagementPage();
    render(jsx);

    const batchList = screen.getByTestId("batch-list");
    const props = JSON.parse(batchList.getAttribute("data-props")!);
    expect(props.initialBatches).toEqual([]);
  });
});
