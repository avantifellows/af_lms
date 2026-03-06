import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// ---- mocks ----

vi.mock("./globals.css", () => ({}));

vi.mock("@/components/Providers", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}));

import RootLayout, { metadata } from "./layout";

// ---- tests ----

describe("RootLayout", () => {
  it("renders children inside Providers", () => {
    render(
      <RootLayout>
        <p>Hello</p>
      </RootLayout>
    );

    expect(screen.getByTestId("providers")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("returns JSX with antialiased body class", () => {
    // Call the function directly to inspect the JSX tree,
    // since jsdom flattens nested <html>/<body> elements
    const jsx = RootLayout({ children: <span>test</span> });

    // Check the top-level <html> element props
    expect(jsx.props.lang).toBe("en");
    expect(jsx.props.suppressHydrationWarning).toBe(true);

    // Check the <body> className via the JSX tree
    const body = jsx.props.children;
    expect(body.props.className).toContain("antialiased");
  });

  it("exports correct metadata", () => {
    expect(metadata.title).toBe("Student Enrollments - Avanti Fellows");
    expect(metadata.description).toBe(
      "Student enrollment management system"
    );
  });
});
