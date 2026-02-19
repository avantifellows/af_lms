import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ActionPointList, { type VisitActionListItem } from "./ActionPointList";

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
    action_type: "principal_meeting",
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
    vi.restoreAllMocks();
  });

  it("renders status-specific controls and only pending delete", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[
          makeAction({ id: 1, status: "pending" }),
          makeAction({ id: 2, status: "in_progress", action_type: "classroom_observation" }),
          makeAction({ id: 3, status: "completed", action_type: "teacher_feedback" }),
        ]}
      />
    );

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/visits/10/actions/2");
    expect(screen.getByRole("link", { name: "View Details" })).toHaveAttribute(
      "href",
      "/visits/10/actions/3"
    );
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("shows Start + Delete only on pending cards", () => {
    render(
      <ActionPointList
        visitId={10}
        actions={[makeAction({ id: 11, status: "pending", action_type: "principal_meeting" })]}
      />
    );

    const card = screen.getByTestId("action-card-11");
    expect(within(card).getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Open" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "View Details" })).not.toBeInTheDocument();
  });

  it("shows Open only on in_progress cards", () => {
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
    expect(within(card).queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
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
            action_type: "teacher_feedback",
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

  it("adds a new action via picker modal", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            action: makeAction({
              id: 200,
              action_type: "classroom_observation",
              status: "pending",
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<ActionPointList visitId={10} actions={[]} />);

    await user.click(screen.getByRole("button", { name: "Add Action Point" }));
    await user.click(screen.getByLabelText("Classroom Observation"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: "classroom_observation" }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Classroom Observation")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    });
  });

  it("creates a principal meeting action card from picker", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            action: makeAction({
              id: 201,
              action_type: "principal_meeting",
              status: "pending",
            }),
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<ActionPointList visitId={10} actions={[]} />);

    await user.click(screen.getByRole("button", { name: "Add Action Point" }));
    await user.click(screen.getByLabelText("Principal Meeting"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_type: "principal_meeting" }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Principal Meeting")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    });
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
        actions={[makeAction({ id: 101, action_type: "principal_meeting", status: "pending" })]}
      />
    );

    expect(screen.getByText("Principal Meeting")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/pm/visits/10/actions/101", {
        method: "DELETE",
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Principal Meeting")).not.toBeInTheDocument();
      expect(screen.getByText("No action points added yet.")).toBeInTheDocument();
    });
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
        actions={[makeAction({ id: 101, action_type: "principal_meeting", status: "pending" })]}
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
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open" })).toBeInTheDocument();
      expect(screen.getByText("In Progress")).toBeInTheDocument();
    });
  });
});
