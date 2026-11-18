import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudentListHeader from "./StudentListHeader";

const OPTIONS = [
  { value: "all", label: "All students" },
  { value: "follow_up", label: "Need follow-up" },
] as const;

function renderHeader(onDownload: () => Promise<void> = vi.fn(async () => {})) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<StudentListHeader title="All students" options={OPTIONS} value="all" onChange={onChange} onDownload={onDownload} />);
  return { user, onChange, onDownload };
}

const filterGroup = () => screen.getByRole("group", { name: "Show Students" });

describe("StudentListHeader", () => {
  it("shows the title and one button per list filter, the current one pressed", () => {
    renderHeader();

    expect(screen.getByRole("heading", { name: "All students" })).toBeInTheDocument();
    const buttons = within(filterGroup()).getAllByRole("button");
    expect(buttons.map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["All students", "true"],
      ["Need follow-up", "false"],
    ]);
  });

  it("reports the list filter picked", async () => {
    const { user, onChange } = renderHeader();

    await user.click(within(filterGroup()).getByRole("button", { name: "Need follow-up" }));

    expect(onChange).toHaveBeenCalledWith("follow_up");
  });

  it("downloads on Download, with no error shown", async () => {
    const { user, onDownload } = renderHeader();

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the file cannot be made, and clears that once a later Download works", async () => {
    const onDownload = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error("chunk failed")).mockResolvedValue();
    const { user } = renderHeader(onDownload);

    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't download this list. Please try again.");

    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onDownload).toHaveBeenCalledTimes(2);
  });
});
