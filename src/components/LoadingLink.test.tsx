import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoadingLink from "./LoadingLink";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
    refresh: mockRefresh,
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

describe("LoadingLink", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renders children initially", () => {
    render(
      <LoadingLink href="/dashboard">Go to Dashboard</LoadingLink>
    );
    expect(screen.getByText("Go to Dashboard")).toBeInTheDocument();
  });

  it("renders as a button element", () => {
    render(
      <LoadingLink href="/test">Click me</LoadingLink>
    );
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("calls router.push with href on click", async () => {
    const user = userEvent.setup();
    render(
      <LoadingLink href="/dashboard">Go</LoadingLink>
    );

    await user.click(screen.getByRole("button"));
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });

  it("shows loading spinner after click", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LoadingLink href="/dashboard">Go</LoadingLink>
    );

    await user.click(screen.getByRole("button"));

    // Spinner element should appear (animate-spin class)
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("shows loadingText when provided during navigation", async () => {
    const user = userEvent.setup();
    render(
      <LoadingLink href="/dashboard" loadingText="Loading...">
        Go to Dashboard
      </LoadingLink>
    );

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Go to Dashboard")).not.toBeInTheDocument();
  });

  it("shows children as fallback text during navigation when no loadingText", async () => {
    const user = userEvent.setup();
    render(
      <LoadingLink href="/dashboard">Go to Dashboard</LoadingLink>
    );

    await user.click(screen.getByRole("button"));

    // Children still visible (used as fallback for loadingText)
    expect(screen.getByText("Go to Dashboard")).toBeInTheDocument();
  });

  it("button is disabled while navigating", async () => {
    const user = userEvent.setup();
    render(
      <LoadingLink href="/dashboard">Go</LoadingLink>
    );

    const button = screen.getByRole("button");
    expect(button).not.toBeDisabled();

    await user.click(button);
    expect(button).toBeDisabled();
  });

  it("applies custom className", () => {
    render(
      <LoadingLink href="/test" className="custom-class">
        Link
      </LoadingLink>
    );
    expect(screen.getByRole("button")).toHaveClass("custom-class");
  });
});
