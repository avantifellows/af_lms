import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }) }));

import type { CurriculumPlanChapter } from "@/lib/curriculum-plans";
import CurriculumPlanChapterDates from "./CurriculumPlanChapterDates";

function chapter(
  chapterId: number,
  chapterName: string,
  subject: [number, string],
  dueDate: string | null = null,
  testDate: string | null = null
): CurriculumPlanChapter {
  return {
    chapterId,
    chapterCode: `C${chapterId}`,
    chapterName,
    subjectId: subject[0],
    subjectName: subject[1],
    dueDate,
    testDate,
  };
}

const PHYSICS: [number, string] = [4, "Physics"];
const CHEMISTRY: [number, string] = [2, "Chemistry"];
const CHAPTERS = [
  chapter(1, "Motion", PHYSICS, "2026-06-30", "2026-07-02"),
  chapter(2, "Waves", PHYSICS),
  chapter(3, "Bonding", CHEMISTRY),
];

function respond(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save Chapter dates" }));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CurriculumPlanChapterDates", () => {
  it("groups Chapters by subject in the order they arrive, with their stored dates", () => {
    render(<CurriculumPlanChapterDates planId={7} chapters={CHAPTERS} readOnly={false} />);

    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Physics", "Chemistry"]);
    const physics = screen.getByRole("region", { name: "Physics" });
    expect(within(physics).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByLabelText("Due date for Motion")).toHaveValue("2026-06-30");
    expect(screen.getByLabelText("Test date for Motion")).toHaveValue("2026-07-02");
    expect(within(physics).getByText("Dated")).toBeInTheDocument();
    expect(within(physics).getByText("Not in plan")).toBeInTheDocument();
  });

  it("saves nothing when no date changed", () => {
    const fetchMock = respond({});
    render(<CurriculumPlanChapterDates planId={7} chapters={CHAPTERS} readOnly={false} />);

    save();

    expect(screen.getByRole("status")).toHaveTextContent("No date changes to save.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends only changed Chapters, clearing emptied dates, and shows warnings", async () => {
    const fetchMock = respond({
      warnings: [{ chapterId: 2, chapterName: "Waves", message: "Chapter Test Date is before its Chapter Due Date" }],
    });
    render(<CurriculumPlanChapterDates planId={7} chapters={CHAPTERS} readOnly={false} />);

    fireEvent.change(screen.getByLabelText("Test date for Motion"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Due date for Waves"), { target: { value: "2026-08-10" } });
    fireEvent.change(screen.getByLabelText("Test date for Waves"), { target: { value: "2026-08-01" } });
    save();

    expect(await screen.findByRole("status")).toHaveTextContent("Chapter dates saved.");
    expect(fetchMock).toHaveBeenCalledWith("/api/curriculum/plans/7/chapters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapters: [
          { chapter_id: 1, due_date: "2026-06-30", test_date: null },
          { chapter_id: 2, due_date: "2026-08-10", test_date: "2026-08-01" },
        ],
      }),
    });
    expect(screen.getByTestId("plan-date-warnings")).toHaveTextContent(
      "Waves: Chapter Test Date is before its Chapter Due Date"
    );
    expect(mockRefresh).toHaveBeenCalled();

    // The saved dates are the new baseline.
    save();
    expect(screen.getByRole("status")).toHaveTextContent("No date changes to save.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A plan details save with "Clear these Chapters' dates and save" refreshes the page with the
  // clashing dates gone; the grid must show that, without losing unsaved edits elsewhere.
  it("takes cleared dates from a refresh and keeps unsaved edits on other Chapters", async () => {
    const fetchMock = respond({ warnings: [] });
    const chapters = [...CHAPTERS, chapter(4, "Optics", PHYSICS, "2026-08-10", "2026-08-12")];
    const { rerender } = render(<CurriculumPlanChapterDates planId={7} chapters={chapters} readOnly={false} />);

    fireEvent.change(screen.getByLabelText("Due date for Waves"), { target: { value: "2026-07-20" } });
    fireEvent.change(screen.getByLabelText("Test date for Optics"), { target: { value: "2026-08-15" } });

    // The server cleared Motion's dates and Optics' test date.
    rerender(
      <CurriculumPlanChapterDates
        planId={7}
        chapters={[
          chapter(1, "Motion", PHYSICS),
          chapter(2, "Waves", PHYSICS),
          chapter(3, "Bonding", CHEMISTRY),
          chapter(4, "Optics", PHYSICS, "2026-08-10"),
        ]}
        readOnly={false}
      />
    );

    expect(screen.getByLabelText("Due date for Motion")).toHaveValue("");
    expect(screen.getByLabelText("Test date for Motion")).toHaveValue("");
    const motionRow = screen.getByLabelText("Due date for Motion").closest("tr") as HTMLElement;
    expect(within(motionRow).getByText("Not in plan")).toBeInTheDocument();
    // Unsaved edits survive: Waves never changed on the server, and Optics' edit wins over the
    // cleared test date.
    expect(screen.getByLabelText("Due date for Waves")).toHaveValue("2026-07-20");
    expect(screen.getByLabelText("Due date for Optics")).toHaveValue("2026-08-10");
    expect(screen.getByLabelText("Test date for Optics")).toHaveValue("2026-08-15");

    save();
    await screen.findByRole("status");
    // Motion matches the server, so only the two edited Chapters are sent.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      chapters: [
        { chapter_id: 2, due_date: "2026-07-20", test_date: null },
        { chapter_id: 4, due_date: "2026-08-10", test_date: "2026-08-15" },
      ],
    });
  });

  it("keeps its saved message when the refresh after its own save arrives", async () => {
    respond({ warnings: [] });
    const { rerender } = render(<CurriculumPlanChapterDates planId={7} chapters={CHAPTERS} readOnly={false} />);

    fireEvent.change(screen.getByLabelText("Due date for Waves"), { target: { value: "2026-07-20" } });
    save();
    expect(await screen.findByRole("status")).toHaveTextContent("Chapter dates saved.");

    rerender(
      <CurriculumPlanChapterDates
        planId={7}
        chapters={[CHAPTERS[0], chapter(2, "Waves", PHYSICS, "2026-07-20"), CHAPTERS[2]]}
        readOnly={false}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Chapter dates saved.");
    expect(screen.getByLabelText("Due date for Waves")).toHaveValue("2026-07-20");
    save();
    expect(screen.getByRole("status")).toHaveTextContent("No date changes to save.");
  });

  it("names each rejected Chapter and keeps the edits unsaved", async () => {
    const fetchMock = respond(
      {
        error: "Invalid Curriculum Plan",
        errors: [
          { field: "chapters", chapterId: 3, chapterName: "Bonding", message: "Chapter Test Date needs a Chapter Due Date" },
        ],
      },
      false
    );
    render(<CurriculumPlanChapterDates planId={7} chapters={CHAPTERS} readOnly={false} />);

    fireEvent.change(screen.getByLabelText("Test date for Bonding"), { target: { value: "2026-09-01" } });
    save();

    const errors = await screen.findByTestId("plan-date-errors");
    expect(errors).toHaveTextContent("Chapter dates were not saved.");
    expect(errors).toHaveTextContent("Bonding: Chapter Test Date needs a Chapter Due Date");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    respond({ warnings: [] });
    save();
    expect(await screen.findByRole("status")).toHaveTextContent("Chapter dates saved.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [() => respond({ error: "Curriculum Plan not found" }, false), "Curriculum Plan not found"],
    [() => respond({}, false), "Could not save Chapter dates"],
    [() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))), "Could not save Chapter dates"],
  ])("shows a form-level error", async (stub, message) => {
    stub();
    render(<CurriculumPlanChapterDates planId={7} chapters={CHAPTERS} readOnly={false} />);

    fireEvent.change(screen.getByLabelText("Due date for Bonding"), { target: { value: "2026-09-01" } });
    save();

    expect(await screen.findByTestId("plan-date-errors")).toHaveTextContent(message);
  });

  it("is read-only for a read-only Admin", () => {
    render(<CurriculumPlanChapterDates planId={7} chapters={CHAPTERS} readOnly />);

    expect(screen.getByLabelText("Due date for Motion")).toBeDisabled();
    expect(screen.getByLabelText("Test date for Waves")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Chapter dates" })).toBeDisabled();
  });

  it("explains an empty Chapter list and offers no Save", () => {
    render(<CurriculumPlanChapterDates planId={7} chapters={[]} readOnly={false} />);

    expect(screen.getByText("No in-syllabus Chapters for this plan's Grade and Exam Tracks.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Chapter dates" })).not.toBeInTheDocument();
  });
});
