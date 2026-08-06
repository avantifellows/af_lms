import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import SchoolFilterSelect from "./SchoolFilterSelect";

it("keeps the checkbox list open while selecting and closes with Done", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();

  render(
    <SchoolFilterSelect
      options={[
        { code: "64037", name: "JNV Agra", region: "North", state: null, district: null },
        { code: "70705", name: "JNV Bhavnagar", region: "West", state: null, district: null },
      ]}
      selectedCodes={[]}
      onSelectedCodesChange={onChange}
    />
  );

  expect(screen.getByRole("button", { name: "Schools: All" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Schools: All" }));
  await user.type(screen.getByRole("searchbox", { name: "Search Schools" }), "agra");
  await user.click(screen.getByRole("checkbox", { name: "JNV Agra (64037)" }));

  expect(screen.getByRole("searchbox", { name: "Search Schools" })).toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(["64037"]);
  expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe(
    "64037"
  );

  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("searchbox", { name: "Search Schools" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Schools: 1 selected" })).toBeInTheDocument();
});

it("clears selections without closing and closes on an outside click", async () => {
  const user = userEvent.setup();
  render(
    <div>
      <SchoolFilterSelect
        options={[{ code: "64037", name: "JNV Agra", region: null, state: null, district: null }]}
        selectedCodes={["64037"]}
      />
      <button type="button">Outside</button>
    </div>
  );

  await user.click(screen.getByRole("button", { name: "Schools: 1 selected" }));
  await user.click(screen.getByRole("button", { name: "Clear" }));

  expect(screen.getByRole("searchbox", { name: "Search Schools" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Schools: All" })).toBeInTheDocument();
  expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe("");

  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("searchbox", { name: "Search Schools" })).not.toBeInTheDocument();
});
