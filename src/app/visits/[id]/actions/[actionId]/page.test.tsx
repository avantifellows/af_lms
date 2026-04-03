import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction";
import { CURRENT_RUBRIC_VERSION } from "@/lib/classroom-observation-rubric";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "@/lib/group-student-discussion";
import { INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG } from "@/lib/individual-af-teacher-interaction";
import { INDIVIDUAL_STUDENT_DISCUSSION_CONFIG } from "@/lib/individual-student-discussion";
import { SCHOOL_STAFF_INTERACTION_CONFIG } from "@/lib/school-staff-interaction";

const {
  mockGetServerSession,
  mockGetUserPermission,
  mockGetFeatureAccess,
  mockQuery,
  mockRedirect,
  mockGetAccurateLocation,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetUserPermission: vi.fn(),
  mockGetFeatureAccess: vi.fn(),
  mockQuery: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  mockGetAccurateLocation: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    ...actual,
    getUserPermission: mockGetUserPermission,
    getFeatureAccess: mockGetFeatureAccess,
  };
});
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/geolocation", () => ({
  getAccurateLocation: (...args: unknown[]) => mockGetAccurateLocation(...args),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import VisitActionDetailPage from "./page";

const pmSession = { user: { email: "pm@avantifellows.org" } };
const adminSession = { user: { email: "admin@avantifellows.org" } };

const pmPermission = {
  level: 1,
  role: "program_manager",
  email: "pm@avantifellows.org",
  school_codes: ["SC001"],
  regions: null,
  program_ids: [1],
  read_only: false,
};

const adminPermission = {
  level: 2,
  role: "admin",
  email: "admin@avantifellows.org",
  school_codes: null,
  regions: ["North"],
  program_ids: [1],
  read_only: false,
};

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    school_code: "SC001",
    school_region: "North",
    school_name: "Test School",
    pm_email: "pm@avantifellows.org",
    visit_date: "2026-02-19",
    status: "in_progress",
    completed_at: null,
    ...overrides,
  };
}

function makeAction(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    visit_id: 1,
    action_type: "principal_interaction",
    status: "in_progress",
    data: {
      questions: { oh_program_feedback: { answer: true } },
    },
    started_at: "2026-02-19T09:00:00.000Z",
    ended_at: null,
    inserted_at: "2026-02-19T08:00:00.000Z",
    updated_at: "2026-02-19T09:00:00.000Z",
    ...overrides,
  };
}

function pageProps(id = "1", actionId = "101") {
  return { params: Promise.resolve({ id, actionId }) };
}

function setupPmAuth() {
  mockGetServerSession.mockResolvedValue(pmSession);
  mockGetUserPermission.mockResolvedValue(pmPermission);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
}

function setupAdminAuth() {
  mockGetServerSession.mockResolvedValue(adminSession);
  mockGetUserPermission.mockResolvedValue(adminPermission);
  mockGetFeatureAccess.mockReturnValue({ canView: true, canEdit: true });
}

describe("VisitActionDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    // Default fetch mock for teacher API (ClassroomObservationForm fetches teachers on mount)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ teachers: [] }),
      })
    );
  });

  it("loads the classroom observation renderer for classroom_observation actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            rubric_version: CURRENT_RUBRIC_VERSION,
            params: {
              teacher_on_time: { score: 1 },
            },
          },
        }),
      ]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Classroom Observation Details")).toBeInTheDocument();
    expect(screen.getByTestId("action-renderer-classroom_observation")).toBeInTheDocument();
    expect(screen.getByTestId("classroom-observation-form")).toBeInTheDocument();
  });

  it("shows unsupported classroom rubric warning and hides save/end actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            rubric_version: "2.0",
            teacher_id: 1,
            teacher_name: "Alice Teacher",
            grade: "10",
            params: {
              teacher_on_time: { score: 1 },
            },
          },
        }),
      ]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByTestId("classroom-unsupported-version-warning")).toHaveTextContent(
      "Unsupported classroom observation rubric version: 2.0"
    );
    expect(screen.queryByRole("button", { name: "Save Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();
    expect(screen.getByTestId("rubric-param-teacher_on_time")).toBeInTheDocument();
  });

  it("bootstraps missing rubric_version and strips legacy classroom keys in PATCH payload", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            class_details: "Grade 9 Maths",
            observations: "Legacy text",
            support_needed: "Legacy support",
            preserved_key: "keep-me",
            params: {
              teacher_on_time: { score: 1, remarks: "Observed" },
            },
            observer_summary_strengths: "Strong opening",
          },
        }),
      ]);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "classroom_observation",
                data: {
                  rubric_version: CURRENT_RUBRIC_VERSION,
                  params: {
                    teacher_on_time: { score: 1, remarks: "Observed" },
                  },
                  observer_summary_strengths: "Strong opening",
                },
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "Save Now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const body = JSON.parse(String(init.body)) as { data: Record<string, unknown> };
    expect(body.data.rubric_version).toBe(CURRENT_RUBRIC_VERSION);
    expect(body.data.params).toEqual({
      teacher_on_time: { score: 1, remarks: "Observed" },
    });
    expect(body.data.observer_summary_strengths).toBe("Strong opening");
    expect(body.data).not.toHaveProperty("class_details");
    expect(body.data).not.toHaveProperty("observations");
    expect(body.data).not.toHaveProperty("support_needed");
    expect(body.data).not.toHaveProperty("preserved_key");
  });

  it("auto-saves classroom observation before calling /end", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            params: {
              teacher_on_time: { score: 1 },
            },
          },
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "classroom_observation",
                data: {
                  rubric_version: CURRENT_RUBRIC_VERSION,
                  params: {
                    teacher_on_time: { score: 1 },
                  },
                },
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "classroom_observation",
                status: "completed",
                ended_at: "2026-02-19T10:00:00.000Z",
                data: {
                  rubric_version: CURRENT_RUBRIC_VERSION,
                  params: {
                    teacher_on_time: { score: 1 },
                  },
                },
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
    });

    const [saveUrl, saveInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(saveUrl).toBe("/api/pm/visits/1/actions/101");
    expect(saveInit.method).toBe("PATCH");

    const saveBody = JSON.parse(String(saveInit.body)) as { data: Record<string, unknown> };
    expect(saveBody.data.rubric_version).toBe(CURRENT_RUBRIC_VERSION);

    const [endUrl, endInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(endUrl).toBe("/api/pm/visits/1/actions/101/end");
    expect(endInit.method).toBe("POST");
    expect(endInit.body).toBe(
      JSON.stringify({ end_lat: 23.02, end_lng: 72.57, end_accuracy: 45 })
    );
  });

  it("shows classroom save failure details and does not call /end", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            rubric_version: CURRENT_RUBRIC_VERSION,
            params: {
              teacher_on_time: { score: 1 },
            },
          },
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "Validation failed",
              details: ["Missing score for Teacher Grooming", "Missing score for Gender Sensitivity Parameters"],
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save observation. Fix errors and try End again.")).toBeInTheDocument();
    });

    expect(screen.getByText("Missing score for Teacher Grooming")).toBeInTheDocument();
    expect(screen.getByText("Missing score for Gender Sensitivity Parameters")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockGetAccurateLocation).not.toHaveBeenCalled();
  });

  it("shows classroom /end 422 guidance with details", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            rubric_version: CURRENT_RUBRIC_VERSION,
            params: {
              teacher_on_time: { score: 1 },
            },
          },
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "classroom_observation",
                data: {
                  rubric_version: CURRENT_RUBRIC_VERSION,
                  params: {
                    teacher_on_time: { score: 1 },
                  },
                },
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "Incomplete rubric",
              details: ["Missing score for Teacher Grooming"],
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(
        screen.getByText("Please complete all required rubric scores before ending this observation.")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Missing score for Teacher Grooming")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "End Action" })).toBeInTheDocument();
  });

  it("loads the principal interaction renderer for principal_interaction actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([makeAction({ action_type: "principal_interaction", data: {} })]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Principal Interaction Details")).toBeInTheDocument();
    expect(screen.getAllByTestId("action-renderer-principal_interaction")).toHaveLength(2);
  });

  it("saves via PATCH and sends sanitized principal interaction data", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([makeAction()]);

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            action: makeAction({
              data: {
                questions: {
                  oh_program_feedback: { answer: true },
                  ip_curriculum_progress: { answer: false },
                },
              },
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    // Click a radio button to change form data
    await user.click(screen.getByTestId("principal-interaction-ip_curriculum_progress-no"));
    await user.click(screen.getByRole("button", { name: "Save Now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const parsedBody = JSON.parse(String(init.body)) as { data: { questions: Record<string, unknown> } };
    expect(parsedBody.data.questions).toBeDefined();
  });

  it("ends an action via save-before-end + /end using GPS and updates UI to completed", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([makeAction()]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi.fn()
      // First call: save-before-end (PATCH)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ action: makeAction() }),
      })
      // Second call: end (POST)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            action: {
              ...makeAction({
                status: "completed",
                ended_at: "2026-02-19T10:00:00.000Z",
              }),
              id: "101",
              visit_id: "1",
            },
          }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // First call: save-before-end PATCH
    const [saveUrl, saveInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(saveUrl).toBe("/api/pm/visits/1/actions/101");
    expect(saveInit.method).toBe("PATCH");

    // Second call: end POST
    const [endUrl, endInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(endUrl).toBe("/api/pm/visits/1/actions/101/end");
    expect(endInit.method).toBe("POST");
    expect(endInit.body).toBe(
      JSON.stringify({ end_lat: 23.02, end_lng: 72.57, end_accuracy: 45 })
    );

    await waitFor(() => {
      expect(screen.getByText("Completed")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();
    });
  });

  it("shows completed action as read-only for PM owner", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([makeAction({ status: "completed", ended_at: "2026-02-19T10:00:00.000Z" })]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Completed actions are read-only for your role.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();
  });

  it("allows admin to edit a completed action while visit is still in progress", async () => {
    setupAdminAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit({ pm_email: "other-pm@avantifellows.org" })])
      .mockResolvedValueOnce([makeAction({ status: "completed", ended_at: "2026-02-19T10:00:00.000Z" })]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByRole("button", { name: "Save Now" })).toBeInTheDocument();
  });

  it("always enforces view-only state when visit is completed", async () => {
    setupAdminAuth();
    mockQuery
      .mockResolvedValueOnce([
        makeVisit({
          pm_email: "other-pm@avantifellows.org",
          status: "completed",
          completed_at: "2026-02-19T11:00:00.000Z",
        }),
      ])
      .mockResolvedValueOnce([makeAction({ status: "in_progress" })]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("This visit is completed and read-only.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();
  });

  it("renders action-not-found state for missing or soft-deleted actions and does not render the form", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValueOnce([makeVisit()]).mockResolvedValueOnce([]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Action not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();

    const [actionSql, actionParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionSql).toContain("deleted_at IS NULL");
    expect(actionParams).toEqual(["1", "101"]);
  });

  it("loads the AF Team Interaction renderer for af_team_interaction actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "af_team_interaction",
          data: {},
        }),
      ]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("AF Team Interaction Details")).toBeInTheDocument();
    expect(screen.getAllByTestId("action-renderer-af_team_interaction")).toHaveLength(2);
  });

  it("bootstraps AF team payload and strips unknown keys on PATCH", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "af_team_interaction",
          data: null,
        }),
      ]);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "af_team_interaction",
                data: { teachers: [], questions: {} },
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "Save Now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const body = JSON.parse(String(init.body)) as { data: Record<string, unknown> };
    expect(body.data).toEqual({ teachers: [], questions: {} });
    expect(body.data).not.toHaveProperty("attendees");
    expect(body.data).not.toHaveProperty("key_discussion");
  });

  it("auto-saves AF team interaction data before calling /end", async () => {
    setupPmAuth();
    const afTeamData = {
      teachers: [{ id: 1, name: "Alice" }],
      questions: Object.fromEntries(
        AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
      ),
    };
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "af_team_interaction",
          data: afTeamData,
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "af_team_interaction",
                data: afTeamData,
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "af_team_interaction",
                status: "completed",
                ended_at: "2026-02-19T10:00:00.000Z",
                data: afTeamData,
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
    });

    const [saveUrl, saveInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(saveUrl).toBe("/api/pm/visits/1/actions/101");
    expect(saveInit.method).toBe("PATCH");

    const [endUrl, endInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(endUrl).toBe("/api/pm/visits/1/actions/101/end");
    expect(endInit.method).toBe("POST");
  });

  it("shows AF team interaction save failure details and does not call /end", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "af_team_interaction",
          data: { teachers: [{ id: 1, name: "Alice" }], questions: {} },
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "Validation failed",
              details: ["Missing answer for question"],
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save form data. Fix errors and try End again.")).toBeInTheDocument();
    });

    expect(screen.getByText("Missing answer for question")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockGetAccurateLocation).not.toHaveBeenCalled();
  });

  it("shows AF team interaction /end 422 guidance with type-specific message", async () => {
    setupPmAuth();
    const afTeamData = {
      teachers: [{ id: 1, name: "Alice" }],
      questions: Object.fromEntries(
        AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
      ),
    };
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "af_team_interaction",
          data: afTeamData,
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "af_team_interaction",
                data: afTeamData,
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "Incomplete data",
              details: ["At least one teacher must be selected"],
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(
        screen.getByText("Please complete all required fields before ending this interaction.")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("At least one teacher must be selected")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "End Action" })).toBeInTheDocument();
  });

  it("loads the Individual AF Teacher Interaction renderer for the action type", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_af_teacher_interaction",
          data: { teachers: [] },
        }),
      ]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Individual AF Teacher Interaction Details")).toBeInTheDocument();
    expect(screen.getAllByTestId("action-renderer-individual_af_teacher_interaction")).toHaveLength(2);
  });

  it("bootstraps null individual teacher interaction data to { teachers: [] }", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_af_teacher_interaction",
          data: null,
        }),
      ]);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "individual_af_teacher_interaction",
                data: { teachers: [] },
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "Save Now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const body = JSON.parse(String(init.body)) as { data: Record<string, unknown> };
    expect(body.data).toEqual({ teachers: [] });
  });

  it("auto-saves individual teacher interaction data before calling /end", async () => {
    setupPmAuth();
    const individualTeacherData = {
      teachers: [
        {
          id: 1,
          name: "Alice",
          attendance: "present",
          questions: Object.fromEntries(
            INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
          ),
        },
      ],
    };
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_af_teacher_interaction",
          data: individualTeacherData,
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "individual_af_teacher_interaction",
                data: individualTeacherData,
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "individual_af_teacher_interaction",
                status: "completed",
                ended_at: "2026-02-19T10:00:00.000Z",
                data: individualTeacherData,
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
    });

    const [saveUrl, saveInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(saveUrl).toBe("/api/pm/visits/1/actions/101");
    expect(saveInit.method).toBe("PATCH");

    const [endUrl, endInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(endUrl).toBe("/api/pm/visits/1/actions/101/end");
    expect(endInit.method).toBe("POST");
  });

  it("shows individual teacher save failure details and does not call /end", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_af_teacher_interaction",
          data: { teachers: [{ id: 1, name: "Alice", attendance: "present", questions: {} }] },
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "Validation failed",
              details: ["Alice: Missing answer for question"],
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(screen.getByText("Could not save form data. Fix errors and try End again.")).toBeInTheDocument();
    });

    expect(screen.getByText("Alice: Missing answer for question")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockGetAccurateLocation).not.toHaveBeenCalled();
  });

  it("shows individual teacher /end 422 guidance with type-specific message mentioning record all teachers", async () => {
    setupPmAuth();
    const individualTeacherData = {
      teachers: [
        {
          id: 1,
          name: "Alice",
          attendance: "present",
          questions: Object.fromEntries(
            INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
          ),
        },
      ],
    };
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_af_teacher_interaction",
          data: individualTeacherData,
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ teachers: [] }) })
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "individual_af_teacher_interaction",
                data: individualTeacherData,
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "Not all teachers recorded",
              details: ["Missing teacher: Bob Smith"],
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(
        screen.getByText("Please complete all required fields and record all teachers before ending this interaction.")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Missing teacher: Bob Smith")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "End Action" })).toBeInTheDocument();
  });

  it("loads the Group Student Discussion renderer for group_student_discussion actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "group_student_discussion",
          data: { grade: null, questions: {} },
        }),
      ]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Student Interaction Details")).toBeInTheDocument();
    expect(screen.getAllByTestId("action-renderer-group_student_discussion")).toHaveLength(2);
  });

  it("bootstraps null group student discussion data to { grade: null, questions: {} }", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "group_student_discussion",
          data: null,
        }),
      ]);

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            action: makeAction({
              action_type: "group_student_discussion",
              data: { grade: null, questions: {} },
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "Save Now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const body = JSON.parse(String(init.body)) as { data: Record<string, unknown> };
    expect(body.data).toEqual({ grade: null, questions: {} });
  });

  it("loads the Individual Student Discussion renderer for individual_student_discussion actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_student_discussion",
          data: { students: [] },
        }),
      ]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Individual Student Interaction Details")).toBeInTheDocument();
    expect(screen.getAllByTestId("action-renderer-individual_student_discussion")).toHaveLength(2);
  });

  it("bootstraps null individual student discussion data to { students: [] }", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_student_discussion",
          data: null,
        }),
      ]);

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            action: makeAction({
              action_type: "individual_student_discussion",
              data: { students: [] },
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "Save Now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const body = JSON.parse(String(init.body)) as { data: Record<string, unknown> };
    expect(body.data).toEqual({ students: [] });
  });

  it("auto-saves group student discussion data before calling /end", async () => {
    setupPmAuth();
    const groupStudentData = {
      grade: 11,
      questions: Object.fromEntries(
        GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
      ),
    };
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "group_student_discussion",
          data: groupStudentData,
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "group_student_discussion",
                data: groupStudentData,
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "group_student_discussion",
                status: "completed",
                ended_at: "2026-02-19T10:00:00.000Z",
                data: groupStudentData,
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
    });

    const [saveUrl, saveInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(saveUrl).toBe("/api/pm/visits/1/actions/101");
    expect(saveInit.method).toBe("PATCH");

    const [endUrl, endInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(endUrl).toBe("/api/pm/visits/1/actions/101/end");
    expect(endInit.method).toBe("POST");
  });

  it("shows individual student /end 422 guidance with type-specific message mentioning add at least one student", async () => {
    setupPmAuth();
    const individualStudentData = {
      students: [
        {
          id: 1,
          name: "Test Student",
          grade: 11,
          questions: Object.fromEntries(
            INDIVIDUAL_STUDENT_DISCUSSION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
          ),
        },
      ],
    };
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "individual_student_discussion",
          data: individualStudentData,
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "individual_student_discussion",
                data: individualStudentData,
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 422,
          json: () =>
            Promise.resolve({
              error: "Validation failed",
              details: ["Missing required answers"],
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(
        screen.getByText("Please complete all required fields and add at least one student before ending this interaction.")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Missing required answers")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "End Action" })).toBeInTheDocument();
  });

  it("loads the School Staff Interaction renderer for school_staff_interaction actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([makeAction({ action_type: "school_staff_interaction", data: {} })]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("School Staff Interaction Details")).toBeInTheDocument();
    expect(screen.getAllByTestId("action-renderer-school_staff_interaction")).toHaveLength(2);
  });

  it("saves via PATCH and sends sanitized school staff interaction data", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "school_staff_interaction",
          data: {
            questions: { gc_staff_concern: { answer: true } },
          },
        }),
      ]);

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            action: makeAction({
              action_type: "school_staff_interaction",
              data: {
                questions: {
                  gc_staff_concern: { answer: true },
                  gc_pertaining_issue: { answer: false },
                },
              },
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByTestId("school-staff-interaction-gc_pertaining_issue-no"));
    await user.click(screen.getByRole("button", { name: "Save Now" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const parsedBody = JSON.parse(String(init.body)) as { data: { questions: Record<string, unknown> } };
    expect(parsedBody.data.questions).toBeDefined();
  });

  it("auto-saves school staff interaction data before calling /end", async () => {
    setupPmAuth();
    const schoolStaffData = {
      questions: Object.fromEntries(
        SCHOOL_STAFF_INTERACTION_CONFIG.allQuestionKeys.map((key) => [key, { answer: true }])
      ),
    };
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "school_staff_interaction",
          data: schoolStaffData,
        }),
      ]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "school_staff_interaction",
                data: schoolStaffData,
              }),
            }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                action_type: "school_staff_interaction",
                status: "completed",
                ended_at: "2026-02-19T10:00:00.000Z",
                data: schoolStaffData,
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
    });

    const [saveUrl, saveInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(saveUrl).toBe("/api/pm/visits/1/actions/101");
    expect(saveInit.method).toBe("PATCH");

    const [endUrl, endInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(endUrl).toBe("/api/pm/visits/1/actions/101/end");
    expect(endInit.method).toBe("POST");
  });

  describe("auto-save", () => {
    it("shows 'Unsaved changes' after form data change", async () => {
      setupPmAuth();
      mockQuery
        .mockResolvedValueOnce([makeVisit()])
        .mockResolvedValueOnce([makeAction()]);

      const jsx = await VisitActionDetailPage(pageProps());
      render(jsx);

      vi.useFakeTimers();

      fireEvent.click(screen.getByTestId("principal-interaction-ip_curriculum_progress-yes"));

      expect(screen.getByTestId("auto-save-status")).toHaveTextContent("Unsaved changes");

      vi.useRealTimers();
    });

    it("auto-saves after 2s debounce and shows 'Saved'", async () => {
      setupPmAuth();
      mockQuery
        .mockResolvedValueOnce([makeVisit()])
        .mockResolvedValueOnce([makeAction()]);

      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                data: { questions: { oh_program_feedback: { answer: true }, ip_curriculum_progress: { answer: true } } },
              }),
            }),
        })
      ) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);

      const jsx = await VisitActionDetailPage(pageProps());
      render(jsx);

      vi.useFakeTimers();

      fireEvent.click(screen.getByTestId("principal-interaction-ip_curriculum_progress-yes"));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByTestId("auto-save-status")).toHaveTextContent("Saved");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/pm/visits/1/actions/101");
      expect(init.method).toBe("PATCH");

      vi.useRealTimers();
    });

    it("auto-dismisses 'Saved' after 3s", async () => {
      setupPmAuth();
      mockQuery
        .mockResolvedValueOnce([makeVisit()])
        .mockResolvedValueOnce([makeAction()]);

      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                data: { questions: { oh_program_feedback: { answer: true }, ip_curriculum_progress: { answer: false } } },
              }),
            }),
        })
      ) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);

      const jsx = await VisitActionDetailPage(pageProps());
      render(jsx);

      vi.useFakeTimers();

      fireEvent.click(screen.getByTestId("principal-interaction-ip_curriculum_progress-no"));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByTestId("auto-save-status")).toHaveTextContent("Saved");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.getByTestId("auto-save-status")).toHaveClass("invisible");

      vi.useRealTimers();
    });

    it("shows 'Save failed' on auto-save error", async () => {
      setupPmAuth();
      mockQuery
        .mockResolvedValueOnce([makeVisit()])
        .mockResolvedValueOnce([makeAction()]);

      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "Server error" }),
        })
      ) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);

      const jsx = await VisitActionDetailPage(pageProps());
      render(jsx);

      vi.useFakeTimers();

      fireEvent.click(screen.getByTestId("principal-interaction-ip_curriculum_progress-yes"));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(screen.getByTestId("auto-save-status")).toHaveTextContent("Save failed");

      vi.useRealTimers();
    });

    it("does not show auto-save indicator in read-only mode", async () => {
      setupPmAuth();
      mockQuery
        .mockResolvedValueOnce([makeVisit({ status: "completed", completed_at: "2026-02-19T11:00:00.000Z" })])
        .mockResolvedValueOnce([makeAction()]);

      const jsx = await VisitActionDetailPage(pageProps());
      render(jsx);

      expect(screen.queryByTestId("auto-save-status")).not.toBeInTheDocument();
    });

    it("manual 'Save Now' cancels pending auto-save", async () => {
      setupPmAuth();
      mockQuery
        .mockResolvedValueOnce([makeVisit()])
        .mockResolvedValueOnce([makeAction()]);

      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              action: makeAction({
                data: { questions: { oh_program_feedback: { answer: true }, ip_curriculum_progress: { answer: true } } },
              }),
            }),
        })
      ) as unknown as typeof fetch;
      vi.stubGlobal("fetch", fetchMock);

      const jsx = await VisitActionDetailPage(pageProps());
      render(jsx);

      vi.useFakeTimers();

      fireEvent.click(screen.getByTestId("principal-interaction-ip_curriculum_progress-yes"));

      expect(screen.getByTestId("auto-save-status")).toHaveTextContent("Unsaved changes");

      // Submit form (triggers handleSave which cancels auto-save timer)
      await act(async () => {
        const form = document.querySelector("form[data-testid='action-renderer-principal_interaction']");
        fireEvent.submit(form!);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance past debounce — auto-save should not fire since it was cancelled
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("beforeunload is prevented when there are unsaved changes", async () => {
      setupPmAuth();
      mockQuery
        .mockResolvedValueOnce([makeVisit()])
        .mockResolvedValueOnce([makeAction()]);

      const jsx = await VisitActionDetailPage(pageProps());
      render(jsx);

      fireEvent.click(screen.getByTestId("principal-interaction-ip_curriculum_progress-yes"));

      const event = new Event("beforeunload", { cancelable: true });
      const spy = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });
  });
});
