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
  default: ({ detail, source, backHref, canRegenerateProfile }: {
    detail: { student: { name: string } };
    source?: "school" | "progress";
    backHref?: string;
    canRegenerateProfile?: boolean;
  }) => (
    <div data-testid="student-phase-workspace"
      data-can-regenerate-profile={String(canRegenerateProfile)}>
      {backHref && <a href={backHref}>{source === "school"
        ? "Back to Assignment Coverage"
        : "Back to Students and Progress"}</a>}
      <h1>{detail.student.name}</h1>
    </div>
  ),
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

  it("renders a scoped Program Manager detail without Profile regeneration capability", async () => {
    mockSession.mockResolvedValue({ user: { email: "manager@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "program_manager" },
      school: { id: 4, name: "School One" },
      canEdit: false,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [],
      selectedPhase: { phaseId: 73, locked: false },
      readOnly: true,
    });

    render(await StudentPhasePage(props));

    expect(screen.getByTestId("student-phase-workspace"))
      .toHaveAttribute("data-can-regenerate-profile", "false");
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({
      role: "program_manager",
      canEdit: false,
    }));
  });

  it("returns a Program Manager opened from Progress to the selected Program workspace", async () => {
    mockSession.mockResolvedValue({ user: { email: "manager@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "program_manager" },
      school: { id: 4, name: "School One" },
      canEdit: false,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [],
      selectedPhase: { phaseId: 73, locked: false },
      readOnly: true,
    });
    const progressProps = {
      ...props,
      searchParams: Promise.resolve({
        school_code: "SCH001",
        academic_year: "2026-2027",
        program_id: "78",
        source: "progress",
      }),
    };

    const { container } = render(await StudentPhasePage(progressProps));

    expect(container.querySelector(
      'a[href="/admin/holistic-mentorship?program_id=78"]'
    )).toBeInTheDocument();
  });

  it("returns a Program Admin opened from Progress to the selected Program workspace", async () => {
    mockSession.mockResolvedValue({ user: { email: "program-admin@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "program_admin" },
      school: { id: 4, name: "School One" },
      canEdit: false,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [],
      selectedPhase: { phaseId: 73, locked: false },
      readOnly: true,
    });
    const progressProps = {
      ...props,
      searchParams: Promise.resolve({
        school_code: "SCH001",
        academic_year: "2026-2027",
        program_id: "78",
        source: "progress",
      }),
    };

    const { container } = render(await StudentPhasePage(progressProps));

    expect(container.querySelector(
      'a[href="/admin/holistic-mentorship?program_id=78"]'
    )).toBeInTheDocument();
  });

  it("returns a global Admin opened from School coverage to that School tab", async () => {
    mockSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "admin" },
      school: { id: 4, name: "School One" },
      canEdit: false,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [],
      selectedPhase: { phaseId: 73, locked: false },
      readOnly: true,
    });
    const schoolProps = {
      ...props,
      searchParams: Promise.resolve({
        school_code: "SCH001",
        academic_year: "2026-2027",
        program_id: "78",
        source: "school",
      }),
    };

    render(await StudentPhasePage(schoolProps));

    expect(screen.getByRole("link", { name: "Back to Assignment Coverage" })).toHaveAttribute(
      "href",
      "/school/SCH001?tab=holistic_mentorship&program_id=78",
    );
  });

  it("returns a Holistic Mentorship Admin opened from School coverage to that School tab", async () => {
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
      selectedPhase: { phaseId: 73, locked: false },
      readOnly: true,
    });
    const schoolProps = {
      ...props,
      searchParams: Promise.resolve({
        school_code: "SCH001",
        academic_year: "2026-2027",
        program_id: "78",
        source: "school",
      }),
    };

    render(await StudentPhasePage(schoolProps));

    expect(screen.getByRole("link", { name: "Back to Assignment Coverage" })).toHaveAttribute(
      "href",
      "/school/SCH001?tab=holistic_mentorship&program_id=78",
    );
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
    expect(container.querySelector(
      'a[href="/admin/holistic-mentorship?program_id=1"]'
    )).toBeInTheDocument();
    expect(mockAccess).toHaveBeenCalledWith(
      { user: { email: "holistic@example.com" } },
      "mapped_student_read",
      { schoolCode: "SCH001", studentId: 41, programId: 1, academicYear: "2025-2026" }
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
      "REDIRECT:/holistic-mentorship/students/41/phases/74?school_code=SCH001&academic_year=2026-2027&program_id=1"
    );
  });

  it("preserves School origin when a Holistic Mentorship Admin is redirected from a Locked Phase", async () => {
    mockSession.mockResolvedValue({ user: { email: "holistic@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "holistic_mentorship_admin" },
      school: { id: 4, name: "School One" },
      canEdit: true,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [
        { phaseId: 73, number: 1, title: "Locked", locked: true },
        { phaseId: 74, number: 2, title: "Current", locked: false, active: true, academicYear: "2026-2027" },
      ],
      selectedPhase: { phaseId: 73, number: 1, title: "Locked", locked: true },
      readOnly: true,
    });
    const schoolProps = {
      ...props,
      searchParams: Promise.resolve({
        school_code: "SCH001",
        academic_year: "2026-2027",
        program_id: "78",
        source: "school",
      }),
    };

    await expect(StudentPhasePage(schoolProps)).rejects.toThrow(
      "REDIRECT:/holistic-mentorship/students/41/phases/74?school_code=SCH001&academic_year=2026-2027&program_id=78&source=school"
    );
  });

  it("preserves Progress origin when a Program Admin is redirected from a Locked Phase", async () => {
    mockSession.mockResolvedValue({ user: { email: "program-admin@example.com" } });
    mockAccess.mockResolvedValue({
      ok: true,
      permission: { role: "program_admin" },
      school: { id: 4, name: "School One" },
      canEdit: false,
    });
    mockDetail.mockResolvedValue({
      student: { name: "Asha Rao" },
      phases: [
        { phaseId: 73, number: 1, title: "Locked", locked: true },
        { phaseId: 74, number: 2, title: "Current", locked: false, active: true, academicYear: "2026-2027" },
      ],
      selectedPhase: { phaseId: 73, number: 1, title: "Locked", locked: true },
      readOnly: true,
    });
    const progressProps = {
      ...props,
      searchParams: Promise.resolve({
        school_code: "SCH001",
        academic_year: "2026-2027",
        program_id: "78",
        source: "progress",
      }),
    };

    await expect(StudentPhasePage(progressProps)).rejects.toThrow(
      "REDIRECT:/holistic-mentorship/students/41/phases/74?school_code=SCH001&academic_year=2026-2027&program_id=78&source=progress"
    );
  });
});
