import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ActionTypePickerModal from "./ActionTypePickerModal";
import { ACTION_TYPE_VALUES, getActionTypeLabel } from "@/lib/visit-actions";

describe("ActionTypePickerModal", () => {
  it("does not render when closed", () => {
    render(
      <ActionTypePickerModal
        isOpen={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders action type options from ACTION_TYPES when open", () => {
    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (const actionType of ACTION_TYPE_VALUES) {
      expect(screen.getByText(getActionTypeLabel(actionType))).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("submits selected action type", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByLabelText("Classroom Observation"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith("classroom_observation");
  });

  it("calls onClose when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <ActionTypePickerModal
        isOpen
        onClose={onClose}
        onSubmit={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
