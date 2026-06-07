import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const {
  mockGetServerSession,
  mockIsAdmin,
  mockRedirect,
  mockGetCentreOptionSets,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockIsAdmin: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockGetCentreOptionSets: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/permissions", () => ({ isAdmin: mockIsAdmin }));
vi.mock("@/lib/centres", () => ({
  getCentreOptionSets: mockGetCentreOptionSets,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./CentreOptionConfig", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => (
    <div data-testid="centre-option-config" data-props={JSON.stringify(props)} />
  ),
}));

import CentreOptionConfigPage from "./page";

const adminSession = {
  user: { email: "admin@avantifellows.org" },
};

describe("CentreOptionConfigPage (server component)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to / when there is no session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    await expect(CentreOptionConfigPage()).rejects.toThrow("REDIRECT:/");
    expect(mockRedirect).toHaveBeenCalledWith("/");
    expect(mockIsAdmin).not.toHaveBeenCalled();
  });

  it("redirects to /dashboard when user is not admin", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(false);

    await expect(CentreOptionConfigPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockIsAdmin).toHaveBeenCalledWith("admin@avantifellows.org");
  });

  it("renders fixed Centre option sets for admin users", async () => {
    mockGetServerSession.mockResolvedValue(adminSession);
    mockIsAdmin.mockResolvedValue(true);
    mockGetCentreOptionSets.mockResolvedValue({
      ok: true,
      optionSets: [
        {
          id: 4,
          code: "stream",
          label: "Centre Stream",
          allowMulti: true,
          sortOrder: 4,
          options: [],
        },
      ],
    });

    const jsx = await CentreOptionConfigPage();
    render(jsx);

    expect(screen.getByText("Centre Options")).toBeInTheDocument();
    expect(screen.getByText("admin@avantifellows.org")).toBeInTheDocument();
    expect(screen.getByText("Centres")).toHaveAttribute("href", "/admin/centres");
    const config = screen.getByTestId("centre-option-config");
    const props = JSON.parse(config.getAttribute("data-props")!);
    expect(props.initialOptionSets[0].code).toBe("stream");
  });
});
