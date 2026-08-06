import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import CurriculumSummaryFiltersForm from "./CurriculumSummaryFiltersForm";

it("keeps downstream filters empty when a school is selected and omits State and District", async () => {
  const user = userEvent.setup();
  render(
    <CurriculumSummaryFiltersForm
      filters={{
        schools: [],
        programs: [],
        grades: [],
        subjects: [],
        examTracks: [],
        regions: [],
        preset: "all",
        flagged: false,
        forceEmpty: false,
      }}
      options={{
        schools: [
          {
            code: "64037",
            name: "JNV Agra",
            region: "North",
            state: "UP",
            district: "Agra",
          },
        ],
        programs: [{ id: 1, name: "JNV CoE" }],
        grades: [11],
        subjects: [{ id: 4, name: "Physics" }],
        examTracks: ["jee_main"],
        regions: ["North"],
      }}
    />
  );

  expect(screen.queryByText("States")).not.toBeInTheDocument();
  expect(screen.queryByText("Districts")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Regions: All" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Schools: All" }));
  await user.click(screen.getByRole("checkbox", { name: "JNV Agra (64037)" }));

  expect(
    document.querySelector<HTMLInputElement>('input[name="schools"]')?.value
  ).toBe("64037");
  expect(
    document.querySelector<HTMLInputElement>('input[name="programs"]')?.value
  ).toBe("");
  expect(document.querySelector<HTMLInputElement>('input[name="grades"]')?.value).toBe("");
  expect(
    document.querySelector<HTMLInputElement>('input[name="subjects"]')?.value
  ).toBe("");
  expect(
    document.querySelector<HTMLInputElement>('input[name="exam_tracks"]')?.value
  ).toBe("");
  expect(push).not.toHaveBeenCalled();
});
