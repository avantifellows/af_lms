import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockRedirect, mockNotFound } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect, notFound: mockNotFound }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/alumni/schools", () => ({ getSchoolName: vi.fn() }));
vi.mock("@/lib/alumni/access", () => ({ reachesSchool: vi.fn() }));
vi.mock("@/components/alumni/AlumniTab", () => ({
  default: ({ schoolCode }: { schoolCode: string }) => <div data-testid="alumni-tab">tab for {schoolCode}</div>,
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, getAlumniPermission: vi.fn() };
});

import { getServerSession } from "next-auth";
import { reachesSchool } from "@/lib/alumni/access";
import { getSchoolName } from "@/lib/alumni/schools";
import { getAlumniPermission, type UserPermission } from "@/lib/permissions";
import AlumniSchoolPage from "./page";

const manager = { email: "caller@avantifellows.org", level: 1, role: "alumni_manager", school_codes: ["1"] } as UserPermission;
const open = (code = "1") => AlumniSchoolPage({ params: Promise.resolve({ code }) });

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { email: "caller@avantifellows.org" } } as never);
  vi.mocked(getSchoolName).mockResolvedValue("RSMS Bathinda");
  vi.mocked(getAlumniPermission).mockResolvedValue(manager);
  vi.mocked(reachesSchool).mockResolvedValue(true);
});

describe("Alumni school page", () => {
  it("sends signed-out visitors to sign in, and 404s an unknown school", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);
    await expect(open()).rejects.toThrow("REDIRECT:/");
    vi.mocked(getSchoolName).mockResolvedValueOnce(null);
    await expect(open("0")).rejects.toThrow("NOT_FOUND");
  });

  it("shows the school's alumni lists to an alumni manager in scope", async () => {
    render(await open());
    expect(screen.getByRole("heading", { name: "RSMS Bathinda · Alumni" })).toBeInTheDocument();
    expect(screen.getByTestId("alumni-tab")).toHaveTextContent("tab for 1");
    expect(screen.getByRole("link", { name: /All schools/ })).toHaveAttribute("href", "/alumni");
  });

  it("refuses a school out of scope, and roles without the alumni feature", async () => {
    vi.mocked(reachesSchool).mockResolvedValueOnce(false);
    render(await open());
    expect(screen.getByText(/don't have access to this school/)).toBeInTheDocument();

    vi.mocked(getAlumniPermission).mockResolvedValueOnce({ ...manager, role: "teacher" });
    render(await open());
    expect(screen.getAllByText(/don't have access to this school/)).toHaveLength(2);
    expect(screen.queryByTestId("alumni-tab")).not.toBeInTheDocument();
  });
});
