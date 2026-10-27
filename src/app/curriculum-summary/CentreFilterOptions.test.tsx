import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CentreFilterOptions from "./CentreFilterOptions";

const OPTIONS = [
  { id: 11, name: "JNV Anand CoE" },
  { id: 12, name: "JNV Anand Nodal" },
  { id: 21, name: "JNV Bhuj CoE" },
];

function renderOptions(onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())) {
  const { container } = render(
    <form onSubmit={onSubmit}>
      <CentreFilterOptions options={OPTIONS} selected={[21]} />
    </form>
  );
  return { form: container.querySelector("form") as HTMLFormElement, onSubmit };
}

const label = (centreId: number) =>
  document.querySelector(`input[name="centres"][value="${centreId}"]`)?.closest("label") as HTMLLabelElement;

describe("CentreFilterOptions", () => {
  it("lists every Centre by id with the selected ones ticked", () => {
    const { form } = renderOptions();

    expect(screen.getAllByRole("checkbox").map((box) => (box as HTMLInputElement).value)).toEqual(["11", "12", "21"]);
    expect(screen.getByRole("checkbox", { name: "JNV Bhuj CoE" })).toBeChecked();
    // Only the ticked Centres are sent; the search box has no name.
    expect([...new FormData(form).entries()]).toEqual([["centres", "21"]]);
  });

  it("narrows the visible Centres as you type, keeping hidden ticked ones in the form", () => {
    const { form } = renderOptions();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search centres" }), { target: { value: " anand " } });

    expect([11, 12, 21].map((id) => label(id).hidden)).toEqual([false, false, true]);
    expect(label(11)).toHaveClass("flex");
    expect(label(21)).not.toHaveClass("flex");
    expect([...new FormData(form).entries()]).toEqual([["centres", "21"]]);
  });

  it("does not submit on Enter and clears the search when the form resets", () => {
    const { form, onSubmit } = renderOptions();
    const search = screen.getByRole("searchbox", { name: "Search centres" });

    fireEvent.change(search, { target: { value: "bhuj" } });
    // keyDown returns false when the default (implicit submission for Enter) was prevented.
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(search, { key: "a" })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    act(() => form.reset());
    expect(search).toHaveValue("");
    expect([11, 12, 21].map((id) => label(id).hidden)).toEqual([false, false, false]);
  });
});
