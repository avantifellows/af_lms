import { render, screen } from "@testing-library/react";
import Providers from "./Providers";

const mockSessionProvider = vi.fn(({ children }: any) => (
  <div data-testid="session-provider">{children}</div>
));

vi.mock("next-auth/react", () => ({
  SessionProvider: (props: any) => mockSessionProvider(props),
}));

describe("Providers", () => {
  it("renders children", () => {
    render(
      <Providers>
        <div>Test Child</div>
      </Providers>
    );
    expect(screen.getByText("Test Child")).toBeInTheDocument();
  });

  it("wraps children in SessionProvider", () => {
    render(
      <Providers>
        <span>Content</span>
      </Providers>
    );
    expect(mockSessionProvider).toHaveBeenCalled();
    const wrapper = screen.getByTestId("session-provider");
    expect(wrapper).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders multiple children", () => {
    render(
      <Providers>
        <div>First</div>
        <div>Second</div>
      </Providers>
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });
});
