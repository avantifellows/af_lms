import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toast from "./Toast";

describe("Toast", () => {
  it("renders message details and calls onDismiss", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <Toast
        variant="error"
        message="Could not save student"
        details={["G10 roll number is required"]}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save student");
    expect(screen.getByTestId("toast-error-details")).toHaveTextContent(
      "G10 roll number is required",
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
