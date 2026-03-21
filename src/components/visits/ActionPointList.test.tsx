import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AF_TEAM_INTERACTION_CONFIG } from "@/lib/af-team-interaction";
import { GROUP_STUDENT_DISCUSSION_CONFIG } from "@/lib/group-student-discussion";

import ActionPointList, {
  getAFTeamInteractionStats,
  getGroupStudentDiscussionStats,
  getIndividualStudentDiscussionStats,
  getIndividualTeacherInteractionStats,
  getPrincipalInteractionStats,
  type VisitActionListItem,
} from "./ActionPointList";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
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

const mockGetAccurateLocation = vi.fn();
vi.mock("@/lib/geolocation", () => ({
  getAccurateLocation: (...args: unknown[]) => mockGetAccurateLocation(...args),
}));

function makeAction(overrides: Partial<VisitActionListItem>): VisitActionListItem {
  return {
    id: 101,
    action_type: "principal_interaction",
    status: "pending",
    started_at: null,
    ended_at: null,
    inserted_at: "2026-02-19T08:00:00.000Z",
    ...overrides,
  };
}

describe("ActionPointList", () => {
  beforeEach(() => {
    mockGetAccurateLocation.mockReset();
    mockPush.mockReset();
    vi.restoreAllMocks();
  });

  it("renders status-specific controls — pending + in_progress have delete", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({ id: 1, status: "pending" }),
          makeAction({ id: 2, status: "in_progress", action_type: "classroom_observation" }),
          makeAction({ id: 3, status: "completed", action_type: "classroom_observation" }),
        ]}
      />
    );

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/visits/10/actions/2");
    expect(screen.getByRole("link", { name: "View Details" })).toHaveAttribute(
      "href",
      "/visits/10/actions/3"
    );
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("shows Start + Delete only on pending cards", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[makeAction({ id: 11, status: "pending", action_type: "principal_interaction" })]}
      />
    );

    const card = screen.getByTestId("action-card-11");
    expect(within(card).getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "View Details" })).not.toBeInTheDocument();
  });

  it("shows Open + Delete on in_progress cards", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 12,
            status: "in_progress",
            action_type: "classroom_observation",
            started_at: "2026-02-19T09:00:00.000Z",
          }),
        ]}
      />
    );

    const card = screen.getByTestId("action-card-12");
    expect(within(card).getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/visits/10/actions/12"
    );
    expect(within(card).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "View Details" })).not.toBeInTheDocument();
  });

  it("shows View Details only on completed cards", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 13,
            status: "completed",
            action_type: "classroom_observation",
            started_at: "2026-02-19T09:00:00.000Z",
            ended_at: "2026-02-19T10:00:00.000Z",
          }),
        ]}
      />
    );

    const card = screen.getByTestId("action-card-13");
    expect(within(card).getByRole("link", { name: "View Details" })).toHaveAttribute(
      "href",
      "/visits/10/actions/13"
    );
    expect(within(card).queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
  });

  it("adds a new action via picker modal — GPS → Create → Start → Redirect", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 50 }),
      cancel: vi.fn(),
    });

    const createdAction = makeAction({
      id: 200,
      action_type: "classroom_observation",
      status: "pending",
    });
    const startedAction = makeAction({
      id: 200,
      action_type: "classroom_observation",
      status: "in_progress",
      started_at: "2026-02-19T09:00:00.000Z",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ action: createdAction }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ action: startedAction }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<ActionPointList visitId={10} actions={[]} />);

    await user.click(screen.getByRole("button", { name: "Add Action Point" }));
    await user.click(screen.getByLabelText("Classroom Observation"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: "classroom_observation" }),
      });
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions/200/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: 23.02,
          start_lng: 72.57,
          start_accuracy: 50,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Classroom Observation")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open" })).toBeInTheDocument();
      expect(mockPush).toHaveBeenCalledWith("/visits/10/actions/200");
    });
  });

  it("add action — GPS failure shows error and creates no action", async () => {
    const user = userEvent.setup();
    const rejectedPromise = Promise.reject(new Error("Location denied"));
    rejectedPromise.catch(() => {}); // prevent unhandled rejection
    mockGetAccurateLocation.mockReturnValue({
      promise: rejectedPromise,
      cancel: vi.fn(),
    });
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<ActionPointList visitId={10} actions={[]} />);

    await user.click(screen.getByRole("button", { name: "Add Action Point" }));
    await user.click(screen.getByLabelText("Classroom Observation"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("Location denied")).toBeInTheDocument();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("add action — create succeeds but start fails → pending action in list, error shown", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 50 }),
      cancel: vi.fn(),
    });

    const createdAction = makeAction({
      id: 201,
      action_type: "classroom_observation",
      status: "pending",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ action: createdAction }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "GPS too far from school" }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<ActionPointList visitId={10} actions={[]} />);

    await user.click(screen.getByRole("button", { name: "Add Action Point" }));
    await user.click(screen.getByLabelText("Classroom Observation"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("GPS too far from school")).toBeInTheDocument();
      expect(screen.getByText("Classroom Observation")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("deletes a pending action card", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ActionPointList
        visitId={10}
        actions={[makeAction({ id: 101, action_type: "principal_interaction", status: "pending" })]}
      />
    );

    expect(screen.getByText("Principal Interaction")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions/101", {
        method: "DELETE",
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Principal Interaction")).not.toBeInTheDocument();
      expect(screen.getByText("No action points added yet.")).toBeInTheDocument();
    });
  });

  it("clicking delete on in_progress action shows confirmation modal", async () => {
    const user = userEvent.setup();

    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 101,
            status: "in_progress",
            action_type: "classroom_observation",
            started_at: "2026-02-19T09:00:00.000Z",
          }),
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("This action point and all its data will be permanently removed. This cannot be undone.")
    ).toBeInTheDocument();
  });

  it("confirming delete on in_progress action calls API and removes card", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 101,
            status: "in_progress",
            action_type: "classroom_observation",
            started_at: "2026-02-19T09:00:00.000Z",
          }),
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions/101", {
        method: "DELETE",
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Classroom Observation")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("canceling delete confirmation modal closes it without deleting", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 101,
            status: "in_progress",
            action_type: "classroom_observation",
            started_at: "2026-02-19T09:00:00.000Z",
          }),
        ]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Classroom Observation")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pending action delete has no confirmation modal — deletes immediately", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ActionPointList
        visitId={10}
        actions={[makeAction({ id: 101, action_type: "principal_interaction", status: "pending" })]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    // No dialog should appear — delete happens immediately
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions/101", {
        method: "DELETE",
      });
    });
  });

  it("in_progress delete button is hidden in readOnly mode", () => {
    render(
      <ActionPointList
        visitId={10}
        readOnly
        actions={[
          makeAction({
            id: 101,
            status: "in_progress",
            action_type: "classroom_observation",
            started_at: "2026-02-19T09:00:00.000Z",
          }),
        ]}
      />
    );

    expect(screen.getByRole("link", { name: "Open" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("starts a pending action with GPS and moves it to in_progress", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 23.02, lng: 72.57, accuracy: 50 }),
      cancel: vi.fn(),
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            action: makeAction({
              id: 101,
              status: "in_progress",
              started_at: "2026-02-19T09:00:00.000Z",
              ended_at: null,
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ActionPointList
        visitId={10}
        actions={[makeAction({ id: 101, action_type: "principal_interaction", status: "pending" })]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => {
      expect(mockGetAccurateLocation).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions/101/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: 23.02,
          start_lng: 72.57,
          start_accuracy: 50,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open" })).toBeInTheDocument();
      expect(screen.getByText("In Progress")).toBeInTheDocument();
      expect(mockPush).toHaveBeenCalledWith("/visits/10/actions/101");
    });
  });

  describe("AF Team Interaction stats on action cards", () => {
    it("renders stats for af_team_interaction card with teachers and answered questions", () => {
      render(
        <ActionPointList
          visitId={10}
          actions={[
            makeAction({
              id: 50,
              action_type: "af_team_interaction",
              status: "in_progress",
              started_at: "2026-03-05T09:00:00.000Z",
              data: {
                teachers: [{ id: 1, name: "Alice" }],
                questions: { op_class_duration: { answer: true } },
              },
            }),
          ]}
        />
      );

      const statsEl = screen.getByTestId("af-team-stats-50");
      expect(statsEl).toHaveTextContent("Teachers:");
      expect(statsEl).toHaveTextContent("1");
      expect(statsEl).toHaveTextContent("1/9");
    });

    it("shows 0/9 when data has teachers but no questions answered", () => {
      render(
        <ActionPointList
          visitId={10}
          actions={[
            makeAction({
              id: 51,
              action_type: "af_team_interaction",
              status: "in_progress",
              started_at: "2026-03-05T09:00:00.000Z",
              data: {
                teachers: [{ id: 1, name: "Alice" }],
                questions: {},
              },
            }),
          ]}
        />
      );

      const statsEl = screen.getByTestId("af-team-stats-51");
      expect(statsEl).toHaveTextContent("0/9 (0%)");
    });

    it("shows nothing when data is empty/undefined", () => {
      render(
        <ActionPointList
          visitId={10}
          actions={[
            makeAction({
              id: 52,
              action_type: "af_team_interaction",
              status: "pending",
              data: undefined,
            }),
          ]}
        />
      );

      expect(screen.queryByTestId("af-team-stats-52")).not.toBeInTheDocument();
    });

    it("shows nothing for non-af_team_interaction action types", () => {
      render(
        <ActionPointList
          visitId={10}
          actions={[
            makeAction({
              id: 53,
              action_type: "principal_interaction",
              status: "in_progress",
              started_at: "2026-03-05T09:00:00.000Z",
              data: {
                teachers: [{ id: 1, name: "Alice" }],
                questions: { op_class_duration: { answer: true } },
              },
            }),
          ]}
        />
      );

      expect(screen.queryByTestId("af-team-stats-53")).not.toBeInTheDocument();
    });
  });
});

describe("getAFTeamInteractionStats", () => {
  it("returns correct counts for partial payload — 2 teachers, 5 of 9 answered", () => {
    const questions: Record<string, { answer: boolean }> = {};
    const keys = AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.slice(0, 5);
    for (const key of keys) {
      questions[key] = { answer: true };
    }
    const result = getAFTeamInteractionStats({
      teachers: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      questions,
    });
    expect(result).toEqual({ teacherCount: 2, answeredCount: 5, totalQuestions: 9 });
  });

  it("returns correct counts for complete payload — all 9 answered", () => {
    const questions: Record<string, { answer: boolean }> = {};
    for (const key of AF_TEAM_INTERACTION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: false };
    }
    const result = getAFTeamInteractionStats({
      teachers: [{ id: 1, name: "Alice" }],
      questions,
    });
    expect(result).toEqual({ teacherCount: 1, answeredCount: 9, totalQuestions: 9 });
  });

  it("returns null for undefined data", () => {
    expect(getAFTeamInteractionStats(undefined)).toBeNull();
  });

  it("returns null for empty object (both counts are 0)", () => {
    expect(getAFTeamInteractionStats({})).toBeNull();
  });

  it("returns null for non-object data", () => {
    expect(getAFTeamInteractionStats("string" as unknown as Record<string, unknown>)).toBeNull();
    expect(getAFTeamInteractionStats(null as unknown as Record<string, unknown>)).toBeNull();
  });

  it("ignores unknown question keys — only counts known keys", () => {
    const result = getAFTeamInteractionStats({
      teachers: [{ id: 1, name: "Alice" }],
      questions: {
        unknown_key: { answer: true },
        op_class_duration: { answer: true },
      },
    });
    expect(result).toEqual({ teacherCount: 1, answeredCount: 1, totalQuestions: 9 });
  });

  it("does NOT count null answers — only true or false count as answered", () => {
    const result = getAFTeamInteractionStats({
      teachers: [{ id: 1, name: "Alice" }],
      questions: { op_class_duration: { answer: null } },
    });
    expect(result).toEqual({ teacherCount: 1, answeredCount: 0, totalQuestions: 9 });
  });

  it("handles non-array teachers gracefully — teacherCount: 0", () => {
    const result = getAFTeamInteractionStats({
      teachers: "not an array",
      questions: { op_class_duration: { answer: true } },
    });
    expect(result).toEqual({ teacherCount: 0, answeredCount: 1, totalQuestions: 9 });
  });

  it("counts teachers correctly even if questions is missing", () => {
    const result = getAFTeamInteractionStats({
      teachers: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    });
    expect(result).toEqual({ teacherCount: 2, answeredCount: 0, totalQuestions: 9 });
  });
});

describe("Individual Teacher Interaction stats on action cards", () => {
  it("renders stats with attendance breakdown for individual_af_teacher_interaction card", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 60,
            action_type: "individual_af_teacher_interaction",
            status: "in_progress",
            started_at: "2026-03-09T09:00:00.000Z",
            data: {
              teachers: [
                { id: 1, name: "Alice", attendance: "present", questions: {} },
                { id: 2, name: "Bob", attendance: "on_leave", questions: {} },
                { id: 3, name: "Charlie", attendance: "absent", questions: {} },
              ],
            },
          }),
        ]}
      />
    );

    const statsEl = screen.getByTestId("individual-teacher-stats-60");
    expect(statsEl).toHaveTextContent("Teachers:");
    expect(statsEl).toHaveTextContent("3 (1 present, 1 leave, 1 absent)");
  });

  it("renders correct counts with multiple present teachers", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 61,
            action_type: "individual_af_teacher_interaction",
            status: "in_progress",
            started_at: "2026-03-09T09:00:00.000Z",
            data: {
              teachers: [
                { id: 1, name: "Alice", attendance: "present", questions: {} },
                { id: 2, name: "Bob", attendance: "present", questions: {} },
              ],
            },
          }),
        ]}
      />
    );

    const statsEl = screen.getByTestId("individual-teacher-stats-61");
    expect(statsEl).toHaveTextContent("2 (2 present, 0 leave, 0 absent)");
  });

  it("shows nothing when data is empty/undefined", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 62,
            action_type: "individual_af_teacher_interaction",
            status: "pending",
            data: undefined,
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("individual-teacher-stats-62")).not.toBeInTheDocument();
  });

  it("shows nothing for non-individual_af_teacher_interaction action types", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 63,
            action_type: "principal_interaction",
            status: "in_progress",
            started_at: "2026-03-09T09:00:00.000Z",
            data: {
              teachers: [
                { id: 1, name: "Alice", attendance: "present", questions: {} },
              ],
            },
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("individual-teacher-stats-63")).not.toBeInTheDocument();
  });
});

describe("getIndividualTeacherInteractionStats", () => {
  it("returns correct counts for mixed attendance", () => {
    const result = getIndividualTeacherInteractionStats({
      teachers: [
        { id: 1, name: "Alice", attendance: "present", questions: {} },
        { id: 2, name: "Bob", attendance: "on_leave", questions: {} },
        { id: 3, name: "Charlie", attendance: "absent", questions: {} },
        { id: 4, name: "Diana", attendance: "present", questions: {} },
      ],
    });
    expect(result).toEqual({
      recordedCount: 4,
      presentCount: 2,
      onLeaveCount: 1,
      absentCount: 1,
    });
  });

  it("returns null for undefined data", () => {
    expect(getIndividualTeacherInteractionStats(undefined)).toBeNull();
  });

  it("returns null for empty teachers array", () => {
    expect(getIndividualTeacherInteractionStats({ teachers: [] })).toBeNull();
  });

  it("returns null for data without teachers key", () => {
    expect(getIndividualTeacherInteractionStats({})).toBeNull();
  });
});

describe("Principal Interaction stats on action cards", () => {
  it("renders stats for principal_interaction card with answered questions", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 70,
            action_type: "principal_interaction",
            status: "in_progress",
            started_at: "2026-03-10T09:00:00.000Z",
            data: {
              questions: {
                oh_program_feedback: { answer: true },
                ip_curriculum_progress: { answer: false },
              },
            },
          }),
        ]}
      />
    );

    const statsEl = screen.getByTestId("principal-interaction-stats-70");
    expect(statsEl).toHaveTextContent("2/7 (29%)");
  });

  it("shows nothing when data is empty/undefined", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 71,
            action_type: "principal_interaction",
            status: "pending",
            data: undefined,
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("principal-interaction-stats-71")).not.toBeInTheDocument();
  });

  it("shows nothing when no questions are answered", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 72,
            action_type: "principal_interaction",
            status: "in_progress",
            started_at: "2026-03-10T09:00:00.000Z",
            data: {
              questions: {},
            },
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("principal-interaction-stats-72")).not.toBeInTheDocument();
  });
});

describe("getPrincipalInteractionStats", () => {
  it("returns correct counts for partial payload — 3 of 7 answered", () => {
    const result = getPrincipalInteractionStats({
      questions: {
        oh_program_feedback: { answer: true },
        ip_curriculum_progress: { answer: false },
        sp_student_performance: { answer: true },
      },
    });
    expect(result).toEqual({ answeredCount: 3, totalQuestions: 7 });
  });

  it("returns correct counts for complete payload — all 7 answered", () => {
    const result = getPrincipalInteractionStats({
      questions: {
        oh_program_feedback: { answer: true },
        ip_curriculum_progress: { answer: false },
        ip_key_events: { answer: true },
        sp_student_performance: { answer: true },
        sn_concerns_raised: { answer: false },
        mp_monthly_plan: { answer: true },
        mp_permissions_obtained: { answer: false },
      },
    });
    expect(result).toEqual({ answeredCount: 7, totalQuestions: 7 });
  });

  it("returns null for undefined data", () => {
    expect(getPrincipalInteractionStats(undefined)).toBeNull();
  });

  it("returns null when no questions are answered (answeredCount is 0)", () => {
    expect(getPrincipalInteractionStats({ questions: {} })).toBeNull();
  });

  it("does NOT count null answers — only true or false count as answered", () => {
    const result = getPrincipalInteractionStats({
      questions: {
        oh_program_feedback: { answer: null },
        ip_curriculum_progress: { answer: true },
      },
    });
    expect(result).toEqual({ answeredCount: 1, totalQuestions: 7 });
  });

  it("ignores unknown question keys — only counts known keys", () => {
    const result = getPrincipalInteractionStats({
      questions: {
        unknown_key: { answer: true },
        oh_program_feedback: { answer: true },
      },
    });
    expect(result).toEqual({ answeredCount: 1, totalQuestions: 7 });
  });
});

describe("Group Student Discussion stats on action cards", () => {
  it("renders stats with grade and answered questions for group_student_discussion card", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 80,
            action_type: "group_student_discussion",
            status: "in_progress",
            started_at: "2026-03-18T09:00:00.000Z",
            data: {
              grade: 11,
              questions: {
                gc_interacted: { answer: true },
                gc_program_updates: { answer: false },
              },
            },
          }),
        ]}
      />
    );

    const statsEl = screen.getByTestId("group-student-stats-80");
    expect(statsEl).toHaveTextContent("Grade:");
    expect(statsEl).toHaveTextContent("11");
    expect(statsEl).toHaveTextContent("2/4 (50%)");
  });

  it("shows nothing when data is empty/undefined", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 81,
            action_type: "group_student_discussion",
            status: "pending",
            data: undefined,
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("group-student-stats-81")).not.toBeInTheDocument();
  });

  it("shows nothing when no questions are answered and grade is null", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 82,
            action_type: "group_student_discussion",
            status: "in_progress",
            started_at: "2026-03-18T09:00:00.000Z",
            data: {
              questions: {},
            },
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("group-student-stats-82")).not.toBeInTheDocument();
  });
});

describe("getGroupStudentDiscussionStats", () => {
  it("returns correct counts for partial payload — grade 11, 2 of 4 answered", () => {
    const result = getGroupStudentDiscussionStats({
      grade: 11,
      questions: {
        gc_interacted: { answer: true },
        gc_program_updates: { answer: false },
      },
    });
    expect(result).toEqual({ grade: 11, answeredCount: 2, totalQuestions: 4 });
  });

  it("returns correct counts for complete payload — all 4 answered", () => {
    const questions: Record<string, { answer: boolean }> = {};
    for (const key of GROUP_STUDENT_DISCUSSION_CONFIG.allQuestionKeys) {
      questions[key] = { answer: true };
    }
    const result = getGroupStudentDiscussionStats({
      grade: 12,
      questions,
    });
    expect(result).toEqual({ grade: 12, answeredCount: 4, totalQuestions: 4 });
  });

  it("returns null for undefined data", () => {
    expect(getGroupStudentDiscussionStats(undefined)).toBeNull();
  });

  it("returns null when grade is null and no questions answered (both zero)", () => {
    expect(getGroupStudentDiscussionStats({ questions: {} })).toBeNull();
  });

  it("returns stats when grade is set but no questions answered", () => {
    const result = getGroupStudentDiscussionStats({ grade: 11, questions: {} });
    expect(result).toEqual({ grade: 11, answeredCount: 0, totalQuestions: 4 });
  });

  it("does NOT count null answers — only true or false count as answered", () => {
    const result = getGroupStudentDiscussionStats({
      grade: 11,
      questions: {
        gc_interacted: { answer: null },
        gc_program_updates: { answer: true },
      },
    });
    expect(result).toEqual({ grade: 11, answeredCount: 1, totalQuestions: 4 });
  });

  it("ignores unknown question keys — only counts known keys", () => {
    const result = getGroupStudentDiscussionStats({
      grade: 12,
      questions: {
        unknown_key: { answer: true },
        gc_interacted: { answer: true },
      },
    });
    expect(result).toEqual({ grade: 12, answeredCount: 1, totalQuestions: 4 });
  });
});

describe("Individual Student Discussion stats on action cards", () => {
  it("renders stats with student count for individual_student_discussion card", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 90,
            action_type: "individual_student_discussion",
            status: "in_progress",
            started_at: "2026-03-18T09:00:00.000Z",
            data: {
              students: [
                { id: 1, name: "Alice", grade: 11, questions: {} },
                { id: 2, name: "Bob", grade: 12, questions: {} },
              ],
            },
          }),
        ]}
      />
    );

    const statsEl = screen.getByTestId("individual-student-stats-90");
    expect(statsEl).toHaveTextContent("Students:");
    expect(statsEl).toHaveTextContent("2");
  });

  it("shows nothing when data is empty/undefined", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 91,
            action_type: "individual_student_discussion",
            status: "pending",
            data: undefined,
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("individual-student-stats-91")).not.toBeInTheDocument();
  });

  it("shows nothing when students array is empty", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({
            id: 92,
            action_type: "individual_student_discussion",
            status: "in_progress",
            started_at: "2026-03-18T09:00:00.000Z",
            data: {
              students: [],
            },
          }),
        ]}
      />
    );

    expect(screen.queryByTestId("individual-student-stats-92")).not.toBeInTheDocument();
  });
});

describe("getIndividualStudentDiscussionStats", () => {
  it("returns correct student count", () => {
    const result = getIndividualStudentDiscussionStats({
      students: [
        { id: 1, name: "Alice", grade: 11, questions: {} },
        { id: 2, name: "Bob", grade: 12, questions: {} },
        { id: 3, name: "Charlie", grade: 11, questions: {} },
      ],
    });
    expect(result).toEqual({ studentCount: 3 });
  });

  it("returns null for undefined data", () => {
    expect(getIndividualStudentDiscussionStats(undefined)).toBeNull();
  });

  it("returns null for empty students array", () => {
    expect(getIndividualStudentDiscussionStats({ students: [] })).toBeNull();
  });

  it("returns null for data without students key", () => {
    expect(getIndividualStudentDiscussionStats({})).toBeNull();
  });
});
