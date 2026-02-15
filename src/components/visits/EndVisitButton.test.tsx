import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EndVisitButton from "./EndVisitButton";

const mockGetAccurateLocation = vi.fn();
const mockGetAccuracyStatus = vi.fn(() => "good" as const);

vi.mock("@/lib/geolocation", () => ({
  getAccurateLocation: (...args: unknown[]) => mockGetAccurateLocation(...args),
  getAccuracyStatus: (...args: unknown[]) => mockGetAccuracyStatus(...args),
}));

describe("EndVisitButton", () => {
  let mockReload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetAccurateLocation.mockReset();
    mockGetAccuracyStatus.mockReset().mockReturnValue("good");
    mockReload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload: mockReload },
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("returns null when alreadyEnded is true", () => {
    const { container } = render(
      <EndVisitButton visitId={1} alreadyEnded={true} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows 'End Visit' button in idle state", () => {
    render(<EndVisitButton visitId={1} alreadyEnded={false} />);
    expect(
      screen.getByRole("button", { name: "End Visit" })
    ).toBeInTheDocument();
  });

  it("shows location acquisition message after clicking End Visit", async () => {
    const user = userEvent.setup();
    // getAccurateLocation returns a never-resolving promise
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: vi.fn(),
    });

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    expect(screen.getByText("Getting your location...")).toBeInTheDocument();
  });

  it("shows Cancel button during location acquisition", async () => {
    const user = userEvent.setup();
    const mockCancel = vi.fn();
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    expect(cancelBtn).toBeInTheDocument();

    await user.click(cancelBtn);
    expect(mockCancel).toHaveBeenCalled();
    // Should return to idle state
    expect(
      screen.getByRole("button", { name: "End Visit" })
    ).toBeInTheDocument();
  });

  it("submits end visit after location is acquired", async () => {
    const user = userEvent.setup();
    const location = { lat: 28.7, lng: 77.1, accuracy: 15 };

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve(location),
      cancel: vi.fn(),
    });

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", mockFetch);

    render(<EndVisitButton visitId={42} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/pm/visits/42/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          end_lat: 28.7,
          end_lng: 77.1,
          end_accuracy: 15,
        }),
      });
    });

    await waitFor(() => {
      expect(mockReload).toHaveBeenCalled();
    });
  });

  it("shows error on location failure", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockImplementation(() => {
      // Defer rejection so the await in handleEnd catches it
      const promise = Promise.resolve().then(() =>
        Promise.reject({
          code: "POSITION_UNAVAILABLE",
          message: "Location information is unavailable.",
        })
      );
      return { promise, cancel: vi.fn() };
    });

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    await waitFor(() => {
      expect(
        screen.getByText("Location information is unavailable.")
      ).toBeInTheDocument();
    });

    // Should show retry button
    expect(
      screen.getByRole("button", { name: "Retry End Visit" })
    ).toBeInTheDocument();
  });

  it("shows permission denied instructions", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockImplementation(() => {
      const promise = Promise.resolve().then(() =>
        Promise.reject({
          code: "PERMISSION_DENIED",
          message: "Location permission was denied.",
        })
      );
      return { promise, cancel: vi.fn() };
    });

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    await waitFor(() => {
      expect(
        screen.getByText("Location permission was denied.")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("How to enable location:")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Location blocked" })
    ).toBeDisabled();
  });

  it("shows error on API failure after location acquired", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 15 }),
      cancel: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Visit already ended" }),
        })
      ) as unknown as typeof fetch
    );

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    await waitFor(() => {
      expect(screen.getByText("Visit already ended")).toBeInTheDocument();
    });
  });

  it("shows moderate accuracy warning when GPS is imprecise", async () => {
    const user = userEvent.setup();
    const location = { lat: 28.7, lng: 77.1, accuracy: 250 };

    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve(location),
      cancel: vi.fn(),
    });
    mockGetAccuracyStatus.mockReturnValue("moderate");

    // Hold fetch open so we can observe the warning during submitting state
    let resolveFetch!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () => new Promise((resolve) => { resolveFetch = resolve; })
      ) as unknown as typeof fetch
    );

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    await waitFor(() => {
      expect(
        screen.getByText(/GPS accuracy is moderate.*250m.*Reading accepted/)
      ).toBeInTheDocument();
    });

    // Also verify "Ending visit..." button text in submitting state
    expect(
      screen.getByRole("button", { name: "Ending visit..." })
    ).toBeDisabled();

    // Resolve fetch to complete the flow
    await act(async () => {
      resolveFetch({ ok: true, json: () => Promise.resolve({ success: true }) });
    });
  });

  it("shows fallback error when API response has no error field", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 15 }),
      cancel: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({}),
        })
      ) as unknown as typeof fetch
    );

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to end visit")).toBeInTheDocument();
    });
  });

  it("shows generic error when fetch throws a non-Error", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 15 }),
      cancel: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject("network down")) as unknown as typeof fetch
    );

    render(<EndVisitButton visitId={1} alreadyEnded={false} />);

    await user.click(screen.getByRole("button", { name: "End Visit" }));

    await waitFor(() => {
      expect(screen.getByText("An error occurred")).toBeInTheDocument();
    });
  });
});
