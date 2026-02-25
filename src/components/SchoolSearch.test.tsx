import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchoolSearch from "./SchoolSearch";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: mockPush, refresh: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

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

  it("typing calls router.push with search term", async () => {
    const user = userEvent.setup();
    render(<SchoolSearch />);
    const input = screen.getByPlaceholderText(
      "Search schools by name, code, or district..."
    );

    await user.type(input, "Delhi");

    // router.push is called on each keystroke (via startTransition)
    expect(mockPush).toHaveBeenCalled();
    // Last call should contain q=Delhi
    const lastCall = mockPush.mock.calls[mockPush.mock.calls.length - 1][0];
    expect(lastCall).toContain("q=Delhi");
  });

  it("clears q param when input is emptied", async () => {
    const user = userEvent.setup();
    render(<SchoolSearch defaultValue="x" />);
    const input = screen.getByPlaceholderText(
      "Search schools by name, code, or district..."
    );

    await user.clear(input);

    const lastCall = mockPush.mock.calls[mockPush.mock.calls.length - 1][0];
    expect(lastCall).not.toContain("q=");
  });

  it("uses custom basePath in router.push URL", async () => {
    const user = userEvent.setup();
    render(<SchoolSearch basePath="/admin/schools" />);
    const input = screen.getByPlaceholderText(
      "Search schools by name, code, or district..."
    );

    await user.type(input, "test");

    const lastCall = mockPush.mock.calls[mockPush.mock.calls.length - 1][0];
    expect(lastCall).toMatch(/^\/admin\/schools\?/);
  });
});
