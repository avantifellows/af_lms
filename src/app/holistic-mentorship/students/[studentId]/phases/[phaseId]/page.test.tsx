import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockDetail, mockNotFound, mockRedirect, mockSession } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockDetail: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  mockRedirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  mockSession: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ notFound: mockNotFound, redirect: mockRedirect }));
vi.mock("@/lib/holistic-mentorship", () => ({ requireHolisticMentorshipAccess: mockAccess }));
vi.mock("@/lib/holistic-student-phase", () => ({ getHolisticStudentPhase: mockDetail }));
vi.mock("@/components/holistic-mentorship/StudentPhaseWorkspace", () => ({
  default: ({ detail }: { detail: { student: { name: string } } }) => <h1>{detail.student.name}</h1>,
}));

import StudentPhasePage from "./page";

const props = {
  params: Promise.resolve({ studentId: "41", phaseId: "73" }),
  searchParams: Promise.resolve({ school_code: "SCH001", academic_year: "2026-2027" }),
};

describe("StudentPhasePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the same read-only Student/Phase page for a Holistic Mentorship Admin", async () => {
    mockSession.mockResolvedValue({ user: { email: "holistic@example.com" } });
    mockAccess.mockResolvedValue({ ok: true, permission: { role: "holistic_mentorship_admin" }, school: { id: 4 } });
    mockDetail.mockResolvedValue({ student: { name: "Asha Rao" } });

    render(await StudentPhasePage(props));

    expect(screen.getByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 41,
      phaseId: 73,
      role: "holistic_mentorship_admin",
    }));
  });
});
