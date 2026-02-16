import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewVisitForm from "./NewVisitForm";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, refresh: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/components/LoadingLink", () => ({
  default: ({ href, children, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mockGetAccurateLocation = vi.fn();
const mockGetAccuracyStatus = vi.fn(() => "good" as const);

vi.mock("@/lib/geolocation", () => ({
  getAccurateLocation: (...args: any[]) => mockGetAccurateLocation(...args),
  getAccuracyStatus: (...args: any[]) => mockGetAccuracyStatus(...args),
}));

describe("NewVisitForm", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetAccurateLocation.mockReset();
    mockGetAccuracyStatus.mockReset().mockReturnValue("good");
    vi.restoreAllMocks();
  });

  it("shows acquiring state on mount", () => {
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    expect(screen.getByText("Getting your location...")).toBeInTheDocument();
    expect(
      screen.getByText(/This may take a moment/)
    ).toBeInTheDocument();
  });

  it("shows acquired state after location success", async () => {
    const location = { lat: 28.7, lng: 77.1, accuracy: 50 };
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve(location),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(screen.getByText("Location acquired")).toBeInTheDocument();
    });

    expect(screen.getByText(/Accuracy: ~50m/)).toBeInTheDocument();
  });

  it("shows error state on location failure", async () => {
    mockGetAccurateLocation.mockImplementation(() => ({
      promise: Promise.resolve().then(() =>
        Promise.reject({
          code: "POSITION_UNAVAILABLE",
          message: "Location information is unavailable.",
        })
      ),
      cancel: vi.fn(),
    }));

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByText("Location information is unavailable.")
      ).toBeInTheDocument();
    });

    // Should show retry button for non-permission errors
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("shows permission denied instructions on PERMISSION_DENIED", async () => {
    mockGetAccurateLocation.mockImplementation(() => ({
      promise: Promise.resolve().then(() =>
        Promise.reject({
          code: "PERMISSION_DENIED",
          message: "Location permission was denied.",
        })
      ),
      cancel: vi.fn(),
    }));

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByText("Location permission was denied.")
      ).toBeInTheDocument();
    });

    expect(screen.getByText("How to enable location:")).toBeInTheDocument();
    // Should NOT show "Try again" for permission denied
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  });

  it("Start Visit button is disabled while acquiring location", () => {
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    const startBtn = screen.getByRole("button", { name: "Start Visit" });
    expect(startBtn).toBeDisabled();
  });

  it("Start Visit button is enabled after location acquired", async () => {
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 50 }),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start Visit" })
      ).not.toBeDisabled();
    });
  });

  it("Start Visit submits and navigates to visit page", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 50 }),
      cancel: vi.fn(),
    });

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 99 }),
      })
    ) as any;
    vi.stubGlobal("fetch", mockFetch);

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start Visit" })
      ).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: "Start Visit" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/pm/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: "12345678",
          start_lat: 28.7,
          start_lng: 77.1,
          start_accuracy: 50,
        }),
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/visits/99");
    });
  });

  it("shows API error on submit failure", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 50 }),
      cancel: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Duplicate visit today" }),
        })
      ) as any
    );

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start Visit" })
      ).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: "Start Visit" }));

    await waitFor(() => {
      expect(screen.getByText("Duplicate visit today")).toBeInTheDocument();
    });

    // Should not have navigated
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows Visit Workflow section", () => {
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    expect(screen.getByText("Visit Workflow")).toBeInTheDocument();
    expect(
      screen.getByText(/Principal Meeting & Core Operations Review/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Feedback & Issue Log/)
    ).toBeInTheDocument();
  });

  it("Cancel link points to school page", () => {
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    const cancelLink = screen.getByText("Cancel and go back");
    expect(cancelLink.closest("a")).toHaveAttribute(
      "href",
      "/school/12345678"
    );
  });

  it("displays school code in disabled input", () => {
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    const codeInput = screen.getByDisplayValue("12345678");
    expect(codeInput).toBeDisabled();
  });

  it("Cancel button during acquiring transitions to idle state", async () => {
    const user = userEvent.setup();
    const mockCancel = vi.fn();
    mockGetAccurateLocation.mockReturnValue({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });

    render(<NewVisitForm udise="12345678" />);

    expect(screen.getByText("Getting your location...")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockCancel).toHaveBeenCalled();
    expect(screen.getByText("Tap to get location")).toBeInTheDocument();
    expect(
      screen.queryByText("Getting your location...")
    ).not.toBeInTheDocument();
  });

  it("Tap to get location re-acquires GPS from idle state", async () => {
    const user = userEvent.setup();
    const mockCancel = vi.fn();
    // First call: stays pending (acquiring), user will cancel
    mockGetAccurateLocation.mockReturnValueOnce({
      promise: new Promise(() => {}),
      cancel: mockCancel,
    });

    render(<NewVisitForm udise="12345678" />);

    // Cancel to go idle
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Tap to get location")).toBeInTheDocument();

    // Second call: resolves with location
    mockGetAccurateLocation.mockReturnValueOnce({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 50 }),
      cancel: vi.fn(),
    });

    await user.click(screen.getByText("Tap to get location"));

    await waitFor(() => {
      expect(screen.getByText("Location acquired")).toBeInTheDocument();
    });
  });

  it("shows moderate accuracy warning when accuracy is not good", async () => {
    mockGetAccuracyStatus.mockReturnValue("moderate");
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 250 }),
      cancel: vi.fn(),
    });

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByText("Location acquired (moderate accuracy)")
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Accuracy: ~250m/)).toBeInTheDocument();
    expect(
      screen.getByText(/Reading accepted, but may be imprecise/)
    ).toBeInTheDocument();
  });

  it("shows fallback error when API response has no error field", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 50 }),
      cancel: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({}),
        })
      ) as any
    );

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start Visit" })
      ).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: "Start Visit" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to create visit")
      ).toBeInTheDocument();
    });
  });

  it("shows generic error when non-Error is thrown during submit", async () => {
    const user = userEvent.setup();
    mockGetAccurateLocation.mockReturnValue({
      promise: Promise.resolve({ lat: 28.7, lng: 77.1, accuracy: 50 }),
      cancel: vi.fn(),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject("network down")) as any
    );

    render(<NewVisitForm udise="12345678" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Start Visit" })
      ).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: "Start Visit" }));

    await waitFor(() => {
      expect(screen.getByText("An error occurred")).toBeInTheDocument();
    });
  });
});
