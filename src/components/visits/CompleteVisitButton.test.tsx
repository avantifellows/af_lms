import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CompleteVisitButton from "./CompleteVisitButton";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: mockRefresh })),
}));

const mockGetAccurateLocation = vi.fn();
vi.mock("@/lib/geolocation", () => ({
  getAccurateLocation: (...args: unknown[]) => mockGetAccurateLocation(...args),
}));

describe("CompleteVisitButton", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    mockGetAccurateLocation.mockReset();
    vi.restoreAllMocks();
  });

  it("renders API error message from /complete response", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.6, lng: 77.2, accuracy: 40 }),
      cancel: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "At least one classroom observation is required" }),
        })
      ) as unknown as typeof fetch
    );

    render(<CompleteVisitButton visitId={10} />);
    await user.click(screen.getByRole("button", { name: "Complete Visit" }));

    await waitFor(() => {
      expect(screen.getByText("At least one classroom observation is required")).toBeInTheDocument();
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("renders /complete details as a list and supports retry after failure", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockImplementation(() => ({
      promise: Promise.resolve({ lat: 28.6, lng: 77.2, accuracy: 40 }),
      cancel: vi.fn(),
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            error: "At least one completed classroom observation is required to complete visit",
            details: [
              "Action 101: rubric_version is required",
              "Action 101: Missing score for Teacher Grooming",
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            visit: { id: 10, status: "completed", completed_at: "2026-02-19T12:00:00.000Z" },
          }),
      }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<CompleteVisitButton visitId={10} />);

    await user.click(screen.getByRole("button", { name: "Complete Visit" }));

    await waitFor(() => {
      expect(
        screen.getByText("At least one completed classroom observation is required to complete visit")
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("complete-visit-error-details")).toBeInTheDocument();
    expect(screen.getByText("Action 101: rubric_version is required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete Visit" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Complete Visit" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("renders geolocation error message when location promise rejects with a plain object", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    const locationError = {
      code: "POSITION_UNAVAILABLE",
      message: "Location information is unavailable. Please check your device settings.",
    };
    const rejectedPromise = Promise.reject(locationError);
    // Prevent unhandled-rejection noise while the component consumes the promise.
    void rejectedPromise.catch(() => {});

    mockGetAccurateLocation.mockReturnValue({
      promise: rejectedPromise,
      cancel: vi.fn(),
    });

    render(<CompleteVisitButton visitId={10} />);
    await user.click(screen.getByRole("button", { name: "Complete Visit" }));

    await waitFor(() => {
      expect(
        screen.getByText("Location information is unavailable. Please check your device settings.")
      ).toBeInTheDocument();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows warning text from success payload and refreshes page", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.6, lng: 77.2, accuracy: 250 }),
      cancel: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              visit: { id: 10, status: "completed", completed_at: "2026-02-19T12:00:00.000Z" },
              warning: "GPS accuracy is moderate (250m). Reading accepted but may be imprecise.",
            }),
        })
      ) as unknown as typeof fetch
    );

    render(<CompleteVisitButton visitId={10} />);
    await user.click(screen.getByRole("button", { name: "Complete Visit" }));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText("GPS accuracy is moderate (250m). Reading accepted but may be imprecise.")
    ).toBeInTheDocument();
  });

  it("shows acquiring state and supports cancel while location is pending", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    let resolveLocation!: (value: { lat: number; lng: number; accuracy: number }) => void;
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise((resolve) => {
        resolveLocation = resolve;
      }),
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ visit: { id: 10, status: "completed", completed_at: null } }),
        })
      ) as unknown as typeof fetch
    );

    render(<CompleteVisitButton visitId={10} />);
    await user.click(screen.getByRole("button", { name: "Complete Visit" }));

    expect(screen.getByText("Getting your location...")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveLocation({ lat: 28.6, lng: 77.2, accuracy: 80 });
    });

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("supports retry after canceling location acquisition", async () => {
    const user = userEvent.setup();
    let rejectFirstLocation!: (reason?: unknown) => void;
    const firstCancel = vi.fn(() => {
      rejectFirstLocation(new Error("Location request was cancelled."));
    });

    mockGetAccurateLocation
      .mockReturnValueOnce({
        promise: new Promise((_, reject) => {
          rejectFirstLocation = reject;
        }),
        cancel: firstCancel,
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({ lat: 28.6, lng: 77.2, accuracy: 60 }),
        cancel: vi.fn(),
      });

    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            visit: { id: 10, status: "completed", completed_at: "2026-02-19T12:00:00.000Z" },
          }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<CompleteVisitButton visitId={10} />);

    await user.click(screen.getByRole("button", { name: "Complete Visit" }));
    expect(screen.getByText("Getting your location...")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(firstCancel).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Complete Visit" })).toBeEnabled();
    });

    await user.click(screen.getByRole("button", { name: "Complete Visit" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
