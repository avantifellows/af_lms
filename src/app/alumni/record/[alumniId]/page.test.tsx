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
vi.mock("@/components/alumni/AlumniForm", () => ({
  default: ({ entry, canEdit }: { entry: { kind: string; id: string }; canEdit?: boolean }) => (
    <div data-testid="alumni-form" data-can-edit={String(canEdit)}>{entry.kind} {entry.id}</div>
  ),
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, canAccessAlumni: vi.fn(), getAlumniPermission: vi.fn() };
});

import { getServerSession } from "next-auth";
import { canAccessAlumni, getAlumniPermission, type UserPermission } from "@/lib/permissions";
import AlumniRecordPage from "./page";

const admin = { email: "caller@avantifellows.org", level: 3, role: "admin", school_codes: null } as UserPermission;
const open = (alumniId = "8340") => AlumniRecordPage({ params: Promise.resolve({ alumniId }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerSession).mockResolvedValue({ user: { email: "caller@avantifellows.org" } } as never);
  vi.mocked(canAccessAlumni).mockResolvedValue(true);
  vi.mocked(getAlumniPermission).mockResolvedValue(admin);
});

describe("Alumni record page", () => {
  it("sends signed-out visitors to sign in", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    await expect(open()).rejects.toThrow("REDIRECT:/");
  });

  it("opens the alumnus's form, editable with edit access", async () => {
    render(await open());
    expect(screen.getByTestId("alumni-form")).toHaveTextContent("alumnus 8340");
    expect(screen.getByTestId("alumni-form")).toHaveAttribute("data-can-edit", "true");
    expect(screen.getByRole("link", { name: /All schools/ })).toHaveAttribute("href", "/alumni");
  });

  it("opens view-only for read-only access", async () => {
    vi.mocked(getAlumniPermission).mockResolvedValue({ ...admin, read_only: true });
    render(await open());
    expect(screen.getByTestId("alumni-form")).toHaveAttribute("data-can-edit", "false");
  });

  it("refuses an alumnus out of scope, and a malformed id without looking it up", async () => {
    vi.mocked(canAccessAlumni).mockResolvedValue(false);
    render(await open());
    expect(screen.getByText(/don't have access to this alumnus/)).toBeInTheDocument();

    vi.mocked(canAccessAlumni).mockClear();
    render(await open("1;drop"));
    expect(canAccessAlumni).not.toHaveBeenCalled();
    expect(screen.queryByTestId("alumni-form")).not.toBeInTheDocument();
  });
});
