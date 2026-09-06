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

it("prunes only downstream selections unavailable after Schools change without navigating", async () => {
  const user = userEvent.setup();
  render(
    <CurriculumSummaryFiltersForm
      filters={{
        schools: ["70705", "64037"],
        programs: [1, 2],
        grades: [11, 12],
        subjects: [4, 7],
        examTracks: ["jee_main", "neet"],
        regions: [],
        preset: "all",
        flagged: false,
        forceEmpty: false,
      }}
      options={{
        schools: [
          { code: "70705", name: "JNV Bhavnagar", region: "West", state: null, district: null },
          { code: "64037", name: "JNV Agra", region: "North", state: null, district: null },
        ],
        programs: [{ id: 1, name: "JNV CoE" }, { id: 2, name: "JNV Nodal" }],
        grades: [11, 12],
        subjects: [{ id: 4, name: "Physics" }, { id: 7, name: "Biology" }],
        examTracks: ["jee_main", "neet"],
        regions: ["North", "West"],
        availability: [
          {
            schoolCode: "70705",
            programId: 1,
            programName: "JNV CoE",
            grade: 11,
            subjectId: 4,
            subjectName: "Physics",
            examTrack: "jee_main",
          },
          {
            schoolCode: "64037",
            programId: 2,
            programName: "JNV Nodal",
            grade: 12,
            subjectId: 7,
            subjectName: "Biology",
            examTrack: "neet",
          },
        ],
      }}
    />
  );

  await user.click(screen.getByRole("button", { name: "Schools: 2 selected" }));
  await user.click(screen.getByRole("checkbox", { name: "JNV Agra (64037)" }));

  expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe("70705");
  expect(document.querySelector<HTMLInputElement>('input[name="programs"]')?.value).toBe("1");
  expect(document.querySelector<HTMLInputElement>('input[name="grades"]')?.value).toBe("11");
  expect(document.querySelector<HTMLInputElement>('input[name="subjects"]')?.value).toBe("4");
  expect(document.querySelector<HTMLInputElement>('input[name="exam_tracks"]')?.value).toBe("jee_main");
  await user.click(screen.getByRole("button", { name: "Programs: 1 selected" }));
  expect(screen.getByRole("checkbox", { name: "JNV CoE (1)" })).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "JNV Nodal (2)" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Subjects: 1 selected" }));
  expect(screen.getByRole("checkbox", { name: "Physics (4)" })).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "Biology (7)" })).not.toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

it("prunes Schools and downstream selections unavailable after Regions change", async () => {
  const user = userEvent.setup();
  render(
    <CurriculumSummaryFiltersForm
      filters={{
        schools: ["70705", "64037"],
        programs: [1, 2],
        grades: [11, 12],
        subjects: [4, 7],
        examTracks: ["jee_main", "neet"],
        regions: [],
        preset: "all",
        flagged: false,
        forceEmpty: false,
      }}
      options={{
        schools: [
          { code: "70705", name: "JNV Bhavnagar", region: "West", state: null, district: null },
          { code: "64037", name: "JNV Agra", region: "North", state: null, district: null },
        ],
        programs: [{ id: 1, name: "JNV CoE" }, { id: 2, name: "JNV Nodal" }],
        grades: [11, 12],
        subjects: [{ id: 4, name: "Physics" }, { id: 7, name: "Biology" }],
        examTracks: ["jee_main", "neet"],
        regions: ["North", "West"],
        availability: [
          {
            schoolCode: "70705",
            programId: 1,
            programName: "JNV CoE",
            grade: 11,
            subjectId: 4,
            subjectName: "Physics",
            examTrack: "jee_main",
          },
          {
            schoolCode: "64037",
            programId: 2,
            programName: "JNV Nodal",
            grade: 12,
            subjectId: 7,
            subjectName: "Biology",
            examTrack: "neet",
          },
        ],
      }}
    />
  );

  await user.click(screen.getByRole("button", { name: "Regions: All" }));
  await user.click(screen.getByRole("checkbox", { name: "North" }));

  expect(document.querySelector<HTMLInputElement>('input[name="regions"]')?.value).toBe("North");
  expect(document.querySelector<HTMLInputElement>('input[name="schools"]')?.value).toBe("64037");
  expect(document.querySelector<HTMLInputElement>('input[name="programs"]')?.value).toBe("2");
  expect(document.querySelector<HTMLInputElement>('input[name="grades"]')?.value).toBe("12");
  expect(document.querySelector<HTMLInputElement>('input[name="subjects"]')?.value).toBe("7");
  expect(document.querySelector<HTMLInputElement>('input[name="exam_tracks"]')?.value).toBe("neet");
  expect(push).not.toHaveBeenCalled();
});
