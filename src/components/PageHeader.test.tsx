import { render, screen } from "@testing-library/react";
import PageHeader from "./PageHeader";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("PageHeader", () => {
  it("renders the title", () => {
    render(<PageHeader title="Dashboard" />);
    expect(
      screen.getByRole("heading", { name: "Dashboard" })
    ).toBeInTheDocument();
  });

  it("shows subtitle when provided", () => {
    render(<PageHeader title="Dashboard" subtitle="Welcome back" />);
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
  });

  it("does not show subtitle when not provided", () => {
    const { container } = render(<PageHeader title="Dashboard" />);
    // Only the h1 exists, no <p> subtitle
    expect(container.querySelector("p.mt-1")).not.toBeInTheDocument();
  });

  it("shows back link when backHref provided", () => {
    render(<PageHeader title="School" backHref="/dashboard" />);
    const backLink = screen.getAllByRole("link").find(
      (l) => l.getAttribute("href") === "/dashboard"
    );
    expect(backLink).toBeDefined();
  });

  it("does not show back link when backHref not provided", () => {
    render(<PageHeader title="Dashboard" />);
    const links = screen.getAllByRole("link");
    // Only link should be sign out
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/api/auth/signout");
  });

  it("shows user email when provided", () => {
    render(<PageHeader title="Dashboard" userEmail="admin@test.com" />);
    expect(screen.getByText("admin@test.com")).toBeInTheDocument();
  });

  it("does not show user email when not provided", () => {
    render(<PageHeader title="Dashboard" />);
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it("always shows sign out link", () => {
    render(<PageHeader title="Dashboard" />);
    const signOut = screen.getByText("Sign out");
    expect(signOut).toBeInTheDocument();
    expect(signOut.closest("a")).toHaveAttribute("href", "/api/auth/signout");
  });

  it("renders actions when provided", () => {
    render(
      <PageHeader
        title="Dashboard"
        actions={<button>Add School</button>}
      />
    );
    expect(
      screen.getByRole("button", { name: "Add School" })
    ).toBeInTheDocument();
  });

  it("does not crash without optional props", () => {
    const { container } = render(<PageHeader title="Minimal" />);
    expect(container.querySelector("header")).toBeInTheDocument();
  });
});
