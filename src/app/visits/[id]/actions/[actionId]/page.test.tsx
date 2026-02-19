import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    action_type: "principal_meeting",
    status: "in_progress",
    data: {
      attendees: "Principal, PM",
      key_discussion: "Old note",
      preserved_key: "keep-me",
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
  });

  it("loads the classroom observation renderer for classroom_observation actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            class_details: "Grade 9 Maths",
            observations: "Students engaged",
            support_needed: "Need worksheet alignment",
          },
        }),
      ]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Classroom Observation Details")).toBeInTheDocument();
    expect(screen.getByTestId("action-renderer-classroom_observation")).toBeInTheDocument();
  });

  it("loads the principal meeting renderer for principal_meeting actions", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([makeAction({ action_type: "principal_meeting" })]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Principal Meeting Details")).toBeInTheDocument();
    expect(screen.getByTestId("action-renderer-principal_meeting")).toBeInTheDocument();
  });

  it("completes a classroom observation by saving details and ending with GPS", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([
        makeAction({
          action_type: "classroom_observation",
          data: {
            class_details: "Grade 9 Maths",
            observations: "Initial",
            support_needed: "",
            preserved_key: "keep-me",
          },
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
                action_type: "classroom_observation",
                data: {
                  class_details: "Grade 9 Maths",
                  observations: "Updated classroom note",
                  support_needed: "",
                  preserved_key: "keep-me",
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
                  class_details: "Grade 9 Maths",
                  observations: "Updated classroom note",
                  support_needed: "",
                  preserved_key: "keep-me",
                },
              }),
            }),
        })
      ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    const observations = screen.getByLabelText("Observations");
    await user.clear(observations);
    await user.type(observations, "Updated classroom note");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [saveUrl, saveInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(saveUrl).toBe("/api/pm/visits/1/actions/101");
    expect(saveInit.method).toBe("PATCH");
    const saveBody = JSON.parse(String(saveInit.body)) as { data: Record<string, string> };
    expect(saveBody.data.observations).toBe("Updated classroom note");
    expect(saveBody.data.preserved_key).toBe("keep-me");

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

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

  it("saves via PATCH and preserves unrelated fields in action data", async () => {
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
                attendees: "Principal, PM",
                key_discussion: "Updated note",
                preserved_key: "keep-me",
              },
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    const keyDiscussion = screen.getByLabelText("Key Discussion");
    await user.clear(keyDiscussion);
    await user.type(keyDiscussion, "Updated note");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101");
    expect(init.method).toBe("PATCH");

    const parsedBody = JSON.parse(String(init.body)) as { data: Record<string, string> };
    expect(parsedBody.data.key_discussion).toBe("Updated note");
    expect(parsedBody.data.preserved_key).toBe("keep-me");
  });

  it("ends an action via /end using GPS and updates UI to completed", async () => {
    setupPmAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit()])
      .mockResolvedValueOnce([makeAction()]);

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 45 }),
      cancel: vi.fn(),
    });

    const fetchMock = vi.fn(() =>
      Promise.resolve({
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
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    await user.click(screen.getByRole("button", { name: "End Action" }));

    await waitFor(() => {
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/pm/visits/1/actions/101/end");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
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
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();
  });

  it("allows admin to edit a completed action while visit is still in progress", async () => {
    setupAdminAuth();
    mockQuery
      .mockResolvedValueOnce([makeVisit({ pm_email: "other-pm@avantifellows.org" })])
      .mockResolvedValueOnce([makeAction({ status: "completed", ended_at: "2026-02-19T10:00:00.000Z" })]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();
  });

  it("renders action-not-found state for missing or soft-deleted actions and does not render the form", async () => {
    setupPmAuth();
    mockQuery.mockResolvedValueOnce([makeVisit()]).mockResolvedValueOnce([]);

    const jsx = await VisitActionDetailPage(pageProps());
    render(jsx);

    expect(screen.getByText("Action not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Action" })).not.toBeInTheDocument();

    const [actionSql, actionParams] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(actionSql).toContain("deleted_at IS NULL");
    expect(actionParams).toEqual(["1", "101"]);
  });
});
