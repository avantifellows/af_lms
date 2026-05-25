import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockQuery,
  mockRedirect,
  mockNotFound,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockNotFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));
vi.mock("@/lib/permissions", () => ({
  getUserPermission: mockGetUserPermission,
  getFeatureAccess: mockGetFeatureAccess,
}));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} className={className} {...props}>{children}</a>,
}));
vi.mock("@/components/visits/GpsMapLink", () => ({
  __esModule: true,
  default: ({ lat, lng }: { lat: number | string | null; lng: number | string | null }) => (
    lat !== null && lng !== null ? <a href={`https://maps.google.com/?q=${lat},${lng}`}>GPS</a> : null
  ),
}));

import SchoolVisitSummaryDetailPage from "./page";

const adminSession = { user: { email: "admin@avantifellows.org" } };
const adminPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  read_only: false,
  program_ids: [1],
};
const programAdminPermission = {
  email: "program-admin@avantifellows.org",
  level: 2,
  role: "program_admin",
  read_only: true,
  regions: ["AHMEDABAD"],
  program_ids: [1],
};
const pmPermission = {
  email: "pm@avantifellows.org",
  level: 3,
  role: "program_manager",
  read_only: false,
  program_ids: [1],
};
const teacherPermission = {
  email: "teacher@avantifellows.org",
  level: 1,
  role: "teacher",
  read_only: false,
  school_codes: ["SC001"],
  program_ids: [1],
};

const visit = {
  id: 101,
  school_code: "SC001",
  school_name: "Test School",
  pm_email: "pm@avantifellows.org",
  pm_name: "Program Manager",
  visit_date: "2026-02-10",
  status: "completed",
  inserted_at: "2026-02-10T04:00:00Z",
  updated_at: "2026-02-10T06:30:00Z",
  completed_at: "2026-02-10T06:30:00Z",
  start_lat: 12.9716,
  start_lng: 77.5946,
  start_accuracy: 8,
  end_lat: 12.972,
  end_lng: 77.595,
  end_accuracy: 9,
};

const actions = [
  {
    id: 201,
    visit_id: 101,
    action_type: "classroom_observation",
    status: "completed",
    data: {
      params: { teacher_on_time: { score: 1, remarks: "Started on time" } },
      observer_summary_strengths: "Students were engaged",
    },
    started_at: "2026-02-10T04:20:00Z",
    ended_at: "2026-02-10T04:50:00Z",
    inserted_at: "2026-02-10T04:15:00Z",
    updated_at: "2026-02-10T04:50:00Z",
  },
  {
    id: 202,
    visit_id: 101,
    action_type: "af_team_interaction",
    status: "completed",
    data: {
      teachers: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      questions: {
        op_class_duration: { answer: true, remark: "Classes are on schedule" },
        op_centre_resources: { answer: false },
      },
    },
    started_at: "2026-02-10T05:00:00Z",
    ended_at: "2026-02-10T05:10:00Z",
    inserted_at: "2026-02-10T04:55:00Z",
    updated_at: "2026-02-10T05:10:00Z",
  },
  {
    id: 203,
    visit_id: 101,
    action_type: "individual_af_teacher_interaction",
    status: "completed",
    data: {
      teachers: [
        {
          id: 1,
          name: "Alice",
          attendance: "present",
          questions: {
            oh_class_duration: { answer: true, remark: "Full class duration" },
            st_grade11_syllabus: { answer: false },
          },
        },
        { id: 2, name: "Bob", attendance: "on_leave", questions: {} },
        { id: 3, name: "Carol", attendance: "absent", questions: {} },
      ],
    },
    started_at: null,
    ended_at: null,
    inserted_at: "2026-02-10T05:11:00Z",
    updated_at: "2026-02-10T05:12:00Z",
  },
  {
    id: 204,
    visit_id: 101,
    action_type: "principal_interaction",
    status: "completed",
    data: {
      questions: {
        oh_program_feedback: { answer: true, remark: "Principal asked for monthly updates" },
      },
    },
    started_at: null,
    ended_at: null,
    inserted_at: "2026-02-10T05:13:00Z",
    updated_at: "2026-02-10T05:14:00Z",
  },
  {
    id: 205,
    visit_id: 101,
    action_type: "group_student_discussion",
    status: "completed",
    data: {
      grade: 12,
      questions: { gc_interacted: { answer: true, remark: "Students shared concerns" } },
    },
    started_at: null,
    ended_at: null,
    inserted_at: "2026-02-10T05:15:00Z",
    updated_at: "2026-02-10T05:16:00Z",
  },
  {
    id: 206,
    visit_id: 101,
    action_type: "individual_student_discussion",
    status: "completed",
    data: {
      entries: [
        {
          id: "entry-1",
          grade: 11,
          students: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
          questions: {
            oh_teaching_concern: { answer: true, remark: "Students want slower pacing" },
            oh_additional_support: { answer: false },
          },
        },
        {
          id: "entry-2",
          grade: 12,
          students: [{ id: 3, name: "Carol" }],
          questions: {},
        },
      ],
    },
    started_at: null,
    ended_at: null,
    inserted_at: "2026-02-10T05:17:00Z",
    updated_at: "2026-02-10T05:18:00Z",
  },
  {
    id: 207,
    visit_id: 101,
    action_type: "school_staff_interaction",
    status: "completed",
    data: {
      questions: { gc_staff_concern: { answer: true, remark: "Staff requested lab support" } },
    },
    started_at: null,
    ended_at: null,
    inserted_at: "2026-02-10T05:19:00Z",
    updated_at: "2026-02-10T05:20:00Z",
  },
  {
    id: 208,
    visit_id: 101,
    action_type: "future_action",
    status: "pending",
    data: {},
    started_at: null,
    ended_at: null,
    inserted_at: "2026-02-10T05:21:00Z",
    updated_at: "2026-02-10T05:22:00Z",
  },
];

function setupAuth(permission = adminPermission, session = adminSession) {
  mockGetServerSession.mockResolvedValue(session);
  mockGetUserPermission.mockResolvedValue(permission);
  mockGetFeatureAccess.mockReturnValue({ access: "edit", canView: true, canEdit: true });
}

function pageProps(id = "101") {
  return { params: Promise.resolve({ id }) };
}

describe("SchoolVisitSummaryDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
  });

  it("redirects roles that cannot use the admin summary", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(SchoolVisitSummaryDetailPage(pageProps())).rejects.toThrow("REDIRECT:/");

    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: {}, isPasscodeUser: true, schoolCode: "70705" });
    await expect(SchoolVisitSummaryDetailPage(pageProps())).rejects.toThrow("REDIRECT:/school/70705");

    vi.clearAllMocks();
    setupAuth(pmPermission, { user: { email: "pm@avantifellows.org" } });
    await expect(SchoolVisitSummaryDetailPage(pageProps())).rejects.toThrow("REDIRECT:/visits");

    vi.clearAllMocks();
    setupAuth(teacherPermission, { user: { email: "teacher@avantifellows.org" } });
    await expect(SchoolVisitSummaryDetailPage(pageProps())).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("returns not found for out-of-scope or soft-deleted visits and uses scoped detail SQL", async () => {
    setupAuth(programAdminPermission, { user: { email: "program-admin@avantifellows.org" } });
    mockQuery.mockResolvedValueOnce([]);

    await expect(SchoolVisitSummaryDetailPage(pageProps("999"))).rejects.toThrow("NOT_FOUND");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("LEFT JOIN school s ON s.code = v.school_code");
    expect(sql).toContain("v.id = $1");
    expect(sql).toContain("v.deleted_at IS NULL");
    expect(sql).toContain("COALESCE(s.region, '') = ANY($2)");
    expect(params).toEqual(["999", ["AHMEDABAD"]]);
  });

  it("renders metadata, GPS, grouped action stats, remarks, and read-only links", async () => {
    setupAuth();
    mockQuery
      .mockResolvedValueOnce([visit])
      .mockResolvedValueOnce(actions);

    const jsx = await SchoolVisitSummaryDetailPage(pageProps());
    render(jsx);

    expect(screen.getByRole("link", { name: /Back to Visit Summary/i })).toHaveAttribute("href", "/school-visit-summary");
    expect(screen.getByRole("heading", { name: "Test School (SC001)" })).toBeInTheDocument();
    expect(screen.getByText("Program Manager")).toBeInTheDocument();
    expect(screen.getByText("pm@avantifellows.org")).toBeInTheDocument();
    expect(screen.getByText("10 Feb 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getByText("2h 30m")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "GPS" })).toHaveLength(2);

    expect(screen.getByRole("heading", { name: "Classroom Observation" })).toBeInTheDocument();
    expect(screen.getByText("Score 1/45")).toBeInTheDocument();
    expect(screen.getByText("Remarks 1")).toBeInTheDocument();
    expect(screen.getByText("Answered 2/9")).toBeInTheDocument();
    expect(screen.getByText("Teachers 2")).toBeInTheDocument();
    expect(screen.getByText("Teachers 3 (1 present, 1 on leave, 1 absent)")).toBeInTheDocument();
    expect(screen.getByText("Avg answered 2/13")).toBeInTheDocument();
    expect(screen.getByText("Answered 1/7")).toBeInTheDocument();
    expect(screen.getByText("Grade 12")).toBeInTheDocument();
    expect(screen.getByText("Answered 1/4")).toBeInTheDocument();
    expect(screen.getByText("Entries 2")).toBeInTheDocument();
    expect(screen.getByText("Students 3")).toBeInTheDocument();
    expect(screen.getByText("Avg answered 1/2")).toBeInTheDocument();
    expect(screen.getByText("Answered 1/2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument();

    const detailLinks = screen.getAllByRole("link", { name: "View full detail" });
    const detailHrefs = detailLinks.map((link) => link.getAttribute("href"));
    expect(detailLinks).toHaveLength(8);
    expect(detailHrefs).toContain("/visits/101/actions/201?from=summary");
    expect(detailHrefs).toContain("/visits/101/actions/208?from=summary");

    const remarks = screen.getByRole("region", { name: "Remarks" });
    expect(within(remarks).getByText("Started on time")).toBeInTheDocument();
    expect(within(remarks).getByText("Students were engaged")).toBeInTheDocument();
    expect(within(remarks).getByText("Classes are on schedule")).toBeInTheDocument();
    expect(within(remarks).getByText("Principal asked for monthly updates")).toBeInTheDocument();
    expect(within(remarks).getByText("Students want slower pacing")).toBeInTheDocument();

    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    expect(screen.queryByText("Start")).not.toBeInTheDocument();
    expect(screen.queryByText("End")).not.toBeInTheDocument();
  });

  it("renders a graceful empty remarks state", async () => {
    setupAuth();
    mockQuery
      .mockResolvedValueOnce([visit])
      .mockResolvedValueOnce([{ ...actions[7], data: {} }]);

    const jsx = await SchoolVisitSummaryDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("No remarks")).toBeInTheDocument();
  });
});
