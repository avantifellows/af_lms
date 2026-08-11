import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchoolSearch from "./SchoolSearch";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, refresh: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

const PLACEHOLDER = "Search schools by name, code, or district...";

function renderSearch(props: Record<string, unknown> = {}) {
  render(<SchoolSearch {...props} />);
  return screen.getByPlaceholderText(PLACEHOLDER);
}

// Navigation is debounced, so every assertion on it has to wait first.
async function lastPushedUrl(): Promise<string> {
  await waitFor(() => expect(mockPush).toHaveBeenCalled());
  return mockPush.mock.calls[mockPush.mock.calls.length - 1][0];
}

describe("SchoolSearch", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renders input with default value", () => {
    render(<SchoolSearch defaultValue="hello" />);
    const input = screen.getByPlaceholderText(
      "Search schools by name, code, or district..."
    );
    expect(input).toHaveValue("hello");
  });

  it("renders input with custom placeholder", () => {
    render(<SchoolSearch placeholder="Type to search..." />);
    expect(screen.getByPlaceholderText("Type to search...")).toBeInTheDocument();
  });

  it("navigates once, after the debounce, with the final search term", async () => {
    const user = userEvent.setup();
    const input = renderSearch();

    await user.type(input, "Delhi");

    // The point of the debounce: 5 keystrokes must not become 5 dashboard
    // renders. Before this, each character fired its own router.push.
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush.mock.calls[0][0]).toContain("q=Delhi");
  });

  it("keeps the input responsive while the navigation is deferred", async () => {
    const user = userEvent.setup();
    const input = renderSearch();

    await user.type(input, "Del");

    // Value updates immediately even though no navigation has fired yet.
    expect(input).toHaveValue("Del");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Enter bypasses the debounce", async () => {
    const user = userEvent.setup();
    const input = renderSearch();

    await user.type(input, "Delhi{Enter}");

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toContain("q=Delhi");
  });

  it("clears q param when input is emptied", async () => {
    const user = userEvent.setup();
    const input = renderSearch({ defaultValue: "x" });

    await user.clear(input);

    expect(await lastPushedUrl()).not.toContain("q=");
  });

  it("uses custom basePath in router.push URL", async () => {
    const user = userEvent.setup();
    const input = renderSearch({ basePath: "/admin/schools" });

    await user.type(input, "test");

    expect(await lastPushedUrl()).toMatch(/^\/admin\/schools\?/);
  });
});
