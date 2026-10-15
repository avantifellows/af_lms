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
vi.mock("@/lib/alumni/schools", () => ({ listAlumniSchools: vi.fn() }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, getAlumniPermission: vi.fn() };
});

import { getServerSession } from "next-auth";
import { listAlumniSchools } from "@/lib/alumni/schools";
import { getAlumniPermission, type UserPermission } from "@/lib/permissions";
import AlumniHomePage from "./page";

const manager = { email: "caller@avantifellows.org", level: 1, role: "alumni_manager", school_codes: ["1", "2"] } as UserPermission;
const school = (code: string, name: string, toAdd: number, alumni: number) => ({ code, name, toAdd, alumni });

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { email: "caller@avantifellows.org" } } as never);
  vi.mocked(getAlumniPermission).mockResolvedValue(manager);
  vi.mocked(listAlumniSchools).mockResolvedValue([]);
  mockRedirect.mockClear();
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

  it("lists the schools in scope with their counts", async () => {
    vi.mocked(listAlumniSchools).mockResolvedValue([school("1", "RSMS Bathinda", 9, 7), school("2", "JNV Pune", 0, 3)]);
    render(await AlumniHomePage());
    expect(screen.getByRole("link", { name: /RSMS Bathinda/ })).toHaveAttribute("href", "/alumni/1");
    expect(screen.getByText("9 to add · 7 alumni")).toBeInTheDocument();
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
