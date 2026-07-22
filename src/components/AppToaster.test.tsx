import { render, screen } from "@testing-library/react";
import AppToaster from "./AppToaster";

const { mockToaster } = vi.hoisted(() => ({
  mockToaster: vi.fn(),
}));

vi.mock("sonner", () => ({
  Toaster: (props: unknown) => {
    mockToaster(props);
    return <div data-testid="app-toaster" />;
  },
}));

describe("AppToaster", () => {
  beforeEach(() => {
    mockToaster.mockClear();
  });

  it("renders the Sonner toaster with app defaults", () => {
    render(<AppToaster />);

    expect(screen.getByTestId("app-toaster")).toBeInTheDocument();
    expect(mockToaster).toHaveBeenCalledWith(
      expect.objectContaining({
        closeButton: false,
        expand: true,
        gap: 10,
        offset: 16,
        visibleToasts: 4,
        toastOptions: expect.objectContaining({
          unstyled: true,
          className: "w-[calc(100vw-2rem)] max-w-md",
        }),
      }),
    );
  });
});
