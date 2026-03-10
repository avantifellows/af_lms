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

  it("af_team_interaction radio is selectable (not disabled)", () => {
    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const radio = screen.getByLabelText("AF Team Interaction");
    expect(radio).not.toBeDisabled();
  });

  it("submits af_team_interaction when selected and Add clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByLabelText("AF Team Interaction"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith("af_team_interaction");
  });

  it("individual_af_teacher_interaction radio is selectable (not disabled)", () => {
    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const radio = screen.getByLabelText("Individual AF Teacher Interaction");
    expect(radio).not.toBeDisabled();
  });

  it("submits individual_af_teacher_interaction when selected and Add clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByLabelText("Individual AF Teacher Interaction"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith("individual_af_teacher_interaction");
  });

  it("principal_interaction radio is selectable (not disabled)", () => {
    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const radio = screen.getByLabelText("Principal Interaction");
    expect(radio).not.toBeDisabled();
  });

  it("submits principal_interaction when selected and Add clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByLabelText("Principal Interaction"));
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSubmit).toHaveBeenCalledWith("principal_interaction");
  });

  it("other 6 action types remain disabled", () => {
    render(
      <ActionTypePickerModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const enabledTypes = new Set(["classroom_observation", "af_team_interaction", "individual_af_teacher_interaction", "principal_interaction"]);
    const disabledTypes = ACTION_TYPE_VALUES.filter((t) => !enabledTypes.has(t));

    expect(disabledTypes).toHaveLength(6);
    for (const actionType of disabledTypes) {
      const radio = screen.getByLabelText(getActionTypeLabel(actionType));
      expect(radio).toBeDisabled();
    }
  });
});
