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

  it("returns a Teacher to the active Holistic Mentorship School tab", async () => {
    mockSession.mockResolvedValue({ user: { email: "teacher@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "teacher" },
      school: { id: 4, name: "School One" },
      actorUserId: 9,
      canEdit: true,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [],
      selectedPhase: { phaseId: 73, locked: false },
    });

    const { container } = render(await StudentPhasePage(props));

    expect(
      container.querySelector('a[href="/school/SCH001?tab=holistic_mentorship"]')
    ).toBeInTheDocument();
  });

  it("renders the same read-only Student/Phase page for a Holistic Mentorship Admin", async () => {
    mockSession.mockResolvedValue({ user: { email: "holistic@example.com" } });
    mockAccess.mockResolvedValue({ ok: true, permission: { role: "holistic_mentorship_admin" }, school: { id: 4 } });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [],
      selectedPhase: { phaseId: 73, locked: false },
    });

    render(await StudentPhasePage(props));

    expect(screen.getByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 41,
      phaseId: 73,
      role: "holistic_mentorship_admin",
    }));
  });

  it("opens a prior-year Admin drill-down from Progress without requiring a current Mapping", async () => {
    mockSession.mockResolvedValue({ user: { email: "holistic@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "holistic_mentorship_admin" },
      school: { id: 4, name: "School One" },
      canEdit: true,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [],
      selectedPhase: {
        phaseId: 73,
        locked: false,
        canEditNotes: false,
        notes: { state: "submitted", answers: [{ answer: "A weekly plan" }] },
      },
      readOnly: true,
    });
    const priorYearProps = {
      ...props,
      searchParams: Promise.resolve({ school_code: "SCH001", academic_year: "2025-2026" }),
    };

    const { container } = render(await StudentPhasePage(priorYearProps));

    expect(screen.getByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
    expect(container.querySelector('a[href="/admin/holistic-mentorship"]')).toBeInTheDocument();
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "holistic@example.com" } },
      "mapped_student_read",
      { schoolCode: "SCH001", studentId: 41, academicYear: "2025-2026" }
    );
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({
      studentId: 41,
      phaseId: 73,
      academicYear: "2025-2026",
      role: "holistic_mentorship_admin",
      canEdit: true,
    }));
  });

  it("redirects a Locked deep link to the Active available Phase in the requested year", async () => {
    mockSession.mockResolvedValue({ user: { email: "teacher@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "teacher" },
      school: { id: 4, name: "School One" },
      actorUserId: 9,
      canEdit: true,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [
        { phaseId: 73, number: 1, title: "Locked", locked: true },
        { phaseId: 72, number: 4, title: "Prior year", locked: false, active: true, academicYear: "2025-2026" },
        { phaseId: 74, number: 2, title: "Current", locked: false, active: true, academicYear: "2026-2027" },
      ],
      selectedPhase: { phaseId: 73, number: 1, title: "Locked", locked: true },
    });

    await expect(StudentPhasePage(props)).rejects.toThrow(
      "REDIRECT:/holistic-mentorship/students/41/phases/74?school_code=SCH001&academic_year=2026-2027"
    );
  });
});
