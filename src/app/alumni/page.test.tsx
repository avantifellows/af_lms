import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/alumni/schools", () => ({ listAlumniSchools: vi.fn(), loadAlumniTotals: vi.fn() }));
// The table tab is a client component with its own tests.
vi.mock("@/components/alumni/AlumniDataTable", () => ({ default: () => <div>missing-data table</div> }));
// The History panel has its own tests; here it's a marker of who gets the button.
vi.mock("@/components/alumni/MassRestore", () => ({
  default: ({ scopeLabel }: { scopeLabel: string }) => <div>history for {scopeLabel}</div>,
}));

vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, getAlumniPermission: vi.fn() };
});

import { getServerSession } from "next-auth";
import { listAlumniSchools, loadAlumniTotals } from "@/lib/alumni/schools";
import { getAlumniPermission, type UserPermission } from "@/lib/permissions";
import AlumniHomePage from "./page";

const manager = { email: "caller@avantifellows.org", level: 1, role: "alumni_manager", school_codes: ["1", "2"] } as UserPermission;
const school = (code: string, name: string, toAdd: number, alumni: number) => ({ code, name, toAdd, alumni });

beforeEach(() => {
  // Clear every mock's calls, so "not called" checks don't see earlier tests.
  vi.clearAllMocks();
  vi.mocked(getServerSession).mockResolvedValue({ user: { email: "caller@avantifellows.org" } } as never);
  vi.mocked(getAlumniPermission).mockResolvedValue(manager);
  vi.mocked(listAlumniSchools).mockResolvedValue([]);
  vi.mocked(loadAlumniTotals).mockResolvedValue({ alumni: 8337, studying: 5726, employed: 1085 });
});

describe("Alumni home page", () => {
  it("sends signed-out visitors to sign in", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    await expect(AlumniHomePage()).rejects.toThrow("REDIRECT:/");
  });

  it("refuses roles without the alumni feature", async () => {
    vi.mocked(getAlumniPermission).mockResolvedValue({ ...manager, role: "teacher" });
    render(await AlumniHomePage());
    expect(screen.getByText(/does not have access to alumni/)).toBeInTheDocument();
    expect(listAlumniSchools).not.toHaveBeenCalled();
  });

  it("shows the person's alumni, studying and employed totals", async () => {
    render(await AlumniHomePage());
    expect(screen.getByText("Alumni", { selector: "span" }).parentElement).toHaveTextContent("8,337");
    expect(screen.getByText("Studying").parentElement).toHaveTextContent("5,726");
    expect(screen.getByText("Employed").parentElement).toHaveTextContent("1,085");
    expect(loadAlumniTotals).toHaveBeenCalledWith(manager);
  });

  it("lists the schools in scope with their counts", async () => {
    vi.mocked(listAlumniSchools).mockResolvedValue([school("1", "RSMS Bathinda", 9, 7), school("2", "JNV Pune", 0, 3)]);
    render(await AlumniHomePage());
    const bathinda = screen.getByRole("link", { name: /RSMS Bathinda/ });
    expect(bathinda).toHaveAttribute("href", "/alumni/1");
    expect(bathinda).toHaveTextContent("9 to add");
    expect(bathinda).toHaveTextContent("7 alumni");
    expect(screen.getByLabelText("Find an alumnus")).toBeInTheDocument();
  });

  it("History for all alumni: only with edit access to every school", async () => {
    render(await AlumniHomePage());
    expect(screen.queryByText("history for all alumni")).not.toBeInTheDocument(); // a level-1 manager
    vi.mocked(getAlumniPermission).mockResolvedValue({ ...manager, level: 3 });
    render(await AlumniHomePage());
    expect(screen.getByText("history for all alumni")).toBeInTheDocument();
  });

  it("opens the missing-data table on ?view=table", async () => {
    render(await AlumniHomePage({ searchParams: Promise.resolve({ view: "table" }) }));
    expect(screen.getByText("missing-data table")).toBeInTheDocument();
    expect(screen.queryByLabelText("Find an alumnus")).not.toBeInTheDocument();
  });

  it("goes straight to the only school", async () => {
    vi.mocked(listAlumniSchools).mockResolvedValue([school("1", "RSMS Bathinda", 9, 7)]);
    await expect(AlumniHomePage()).rejects.toThrow("REDIRECT:/alumni/1");
  });

  it("says so when no school has pass-outs or alumni", async () => {
    render(await AlumniHomePage());
    expect(screen.getByText(/None of your schools/)).toBeInTheDocument();
  });
});
